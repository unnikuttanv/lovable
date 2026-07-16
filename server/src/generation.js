// Generation lifecycle: quota check, call model, parse manifest, update project.
// Preview execution happens in the user's browser (Sandpack) — the server never
// runs generated code. Each generation buffers its events for SSE replay.
import crypto from 'node:crypto';
import { streamChat } from './openrouter.js';
import { buildMessages } from './prompts.js';
import { getProject, saveProject, getUsage, incrementUsage } from './storage.js';
import { validateFilePath } from './runnerSync.js';

const DAILY_LIMIT = Number(process.env.DAILY_GENERATION_LIMIT || 50);
const generations = new Map(); // genId -> { owner, events: [], subscribers: Set<fn>, finished: bool }

export function getGeneration(genId, owner) {
  const gen = generations.get(genId);
  if (!gen || gen.owner !== owner) return null;
  return gen;
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

export function startGeneration(projectId, userPrompt, owner) {
  const genId = crypto.randomUUID().slice(0, 12);
  const gen = { owner, events: [], subscribers: new Set(), finished: false };
  generations.set(genId, gen);
  run(gen, projectId, userPrompt, owner).catch((err) => {
    emit(gen, 'error', { message: err.message });
  });
  setTimeout(() => generations.delete(genId), 10 * 60 * 1000).unref?.();
  return genId;
}

async function run(gen, projectId, userPrompt, owner) {
  const project = await getProject(projectId, owner);
  if (!project) throw new Error('Project not found');

  const used = await getUsage(owner);
  if (used >= DAILY_LIMIT) {
    throw new Error(`Daily limit of ${DAILY_LIMIT} generations reached — resets at midnight UTC.`);
  }
  await incrementUsage(owner);

  const messages = buildMessages(project, userPrompt);
  project.messages.push({ role: 'user', kind: 'chat', content: userPrompt, ts: Date.now() });
  await saveProject(project);

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
    await saveProject(project);
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
  if (manifest.dependencies && typeof manifest.dependencies === 'object') {
    for (const [pkg, ver] of Object.entries(manifest.dependencies)) {
      if (/^[a-z0-9@][a-z0-9._/@-]*$/i.test(pkg)) project.dependencies[pkg] = String(ver);
    }
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
  await saveProject(project);

  emit(gen, 'files', { paths: manifest.files.map((f) => f.path), summary: manifest.summary });
  emit(gen, 'done', { versionId: version.id });
}
