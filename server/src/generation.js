// Generation lifecycle: call model, parse manifest, update project, sync runner.
// Each generation buffers its events so an SSE client can connect late and replay.
import crypto from 'node:crypto';
import { streamChat } from './openrouter.js';
import { buildMessages } from './prompts.js';
import { getProject, saveProject } from './store.js';
import { activateProject, validateFilePath } from './runnerSync.js';

const generations = new Map(); // genId -> { events: [], subscribers: Set<fn>, finished: bool }

export function getGeneration(genId) {
  return generations.get(genId) || null;
}

function emit(gen, event, data) {
  const entry = { event, data };
  gen.events.push(entry);
  if (event === 'done' || event === 'error') gen.finished = true;
  for (const fn of gen.subscribers) fn(entry);
}

export function subscribe(gen, fn) {
  gen.subscribers.add(fn);
  return () => gen.subscribers.delete(fn);
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model response');
  return JSON.parse(text.slice(start, end + 1));
}

function currentFileFromPartial(text) {
  const matches = text.match(/"path"\s*:\s*"([^"]+)"/g);
  if (!matches) return null;
  const last = matches[matches.length - 1];
  return last.match(/"path"\s*:\s*"([^"]+)"/)[1];
}

export function startGeneration(projectId, userPrompt) {
  const genId = crypto.randomUUID().slice(0, 12);
  const gen = { events: [], subscribers: new Set(), finished: false };
  generations.set(genId, gen);
  run(gen, projectId, userPrompt).catch((err) => {
    emit(gen, 'error', { message: err.message });
  });
  // drop finished generations after 10 minutes
  setTimeout(() => generations.delete(genId), 10 * 60 * 1000).unref?.();
  return genId;
}

async function run(gen, projectId, userPrompt) {
  const project = getProject(projectId);
  if (!project) throw new Error('Project not found');

  const messages = buildMessages(project, userPrompt);
  project.messages.push({ role: 'user', kind: 'chat', content: userPrompt, ts: Date.now() });
  saveProject(project);

  emit(gen, 'status', { stage: 'Calling ' + project.model });

  let lastTokenEmit = 0;
  const onToken = (_token, fullText) => {
    const now = Date.now();
    if (now - lastTokenEmit < 100) return;
    lastTokenEmit = now;
    emit(gen, 'token', {
      text: fullText.slice(-400),
      file: currentFileFromPartial(fullText),
      chars: fullText.length,
    });
  };

  let raw = await streamChat({ model: project.model, messages, onToken });

  emit(gen, 'status', { stage: 'Parsing response' });
  let manifest;
  try {
    manifest = extractJson(raw);
  } catch {
    emit(gen, 'status', { stage: 'Invalid JSON — retrying once' });
    const retryMessages = [
      ...messages,
      { role: 'assistant', content: raw.slice(0, 8000) },
      { role: 'user', content: 'Your previous reply was not valid JSON. Respond again with ONLY the JSON object, exactly per the format rules.' },
    ];
    raw = await streamChat({ model: project.model, messages: retryMessages, onToken });
    manifest = extractJson(raw); // second failure propagates to the error handler
  }

  if (manifest.type === 'chat') {
    project.messages.push({ role: 'assistant', kind: 'chat', content: manifest.message || '…', ts: Date.now() });
    saveProject(project);
    emit(gen, 'chat', { message: manifest.message });
    emit(gen, 'done', { versionId: null });
    return;
  }

  if (manifest.type !== 'code' || !Array.isArray(manifest.files)) {
    throw new Error('Model returned an unexpected manifest shape');
  }

  emit(gen, 'status', { stage: 'Writing files' });
  const invalid = manifest.files.filter((f) => !validateFilePath(f.path));
  if (invalid.length) throw new Error('Model produced invalid file paths: ' + invalid.map((f) => f.path).join(', '));

  for (const f of manifest.files) {
    project.files[f.path.replaceAll('\\', '/')] = String(f.content ?? '');
  }
  for (const del of manifest.deleted || []) {
    if (validateFilePath(del)) delete project.files[del.replaceAll('\\', '/')];
  }
  if (!project.files['src/App.jsx']) throw new Error('Generated project is missing src/App.jsx');

  const version = {
    id: crypto.randomUUID().slice(0, 8),
    label: userPrompt.slice(0, 80),
    ts: Date.now(),
    files: { ...project.files },
  };
  project.versions.push(version);
  project.messages.push({
    role: 'assistant',
    kind: 'code',
    content: manifest.summary || 'Updated the app.',
    versionId: version.id,
    ts: Date.now(),
  });
  saveProject(project);
  activateProject(project);

  emit(gen, 'files', { paths: manifest.files.map((f) => f.path), summary: manifest.summary });
  emit(gen, 'done', { versionId: version.id });
}
