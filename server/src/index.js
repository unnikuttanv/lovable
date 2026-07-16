import 'dotenv/config';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import archiver from 'archiver';
import { listProjects, createProject, getProject, saveProject, deleteProject } from './store.js';
import { startGeneration, getGeneration, subscribe } from './generation.js';
import { activateProject } from './runnerSync.js';
import { publishProject, PUBLISHED_DIR } from './publish.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'client');
const PORT = 3001;
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(CLIENT_DIR));
app.use('/p', express.static(PUBLISHED_DIR));

const MODELS = [
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'deepseek/deepseek-chat-v3-0324', name: 'DeepSeek V3' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
];

app.get('/api/models', (req, res) => {
  res.json({ models: MODELS, default: DEFAULT_MODEL });
});

app.get('/api/projects', (req, res) => {
  res.json(listProjects());
});

app.post('/api/projects', (req, res) => {
  const { prompt, model } = req.body || {};
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
  const name = prompt.trim().slice(0, 40);
  const project = createProject({ name, model: model || DEFAULT_MODEL });
  const generationId = startGeneration(project.id, prompt.trim());
  res.json({ project, generationId });
});

app.get('/api/projects/:id', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });
  res.json(project);
});

app.patch('/api/projects/:id', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });
  if (req.body?.name?.trim()) project.name = req.body.name.trim().slice(0, 60);
  saveProject(project);
  res.json(project);
});

app.delete('/api/projects/:id', (req, res) => {
  res.json({ deleted: deleteProject(req.params.id) });
});

app.post('/api/projects/:id/messages', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });
  const { prompt } = req.body || {};
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });
  const generationId = startGeneration(project.id, prompt.trim());
  res.json({ generationId });
});

app.get('/api/generations/:genId/stream', (req, res) => {
  const gen = getGeneration(req.params.genId);
  if (!gen) return res.status(404).json({ error: 'not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = ({ event, data }) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (event === 'done' || event === 'error') res.end();
  };

  for (const entry of gen.events) send(entry);
  if (gen.finished) return;

  const unsubscribe = subscribe(gen, send);
  req.on('close', unsubscribe);
});

app.post('/api/projects/:id/activate', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });
  activateProject(project);
  res.json({ ok: true });
});

app.post('/api/projects/:id/restore', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });
  const version = project.versions.find((v) => v.id === req.body?.versionId);
  if (!version) return res.status(404).json({ error: 'version not found' });

  project.files = { ...version.files };
  const restored = {
    id: crypto.randomUUID().slice(0, 8),
    label: `Restore: ${version.label}`.slice(0, 80),
    ts: Date.now(),
    files: { ...version.files },
  };
  project.versions.push(restored);
  project.messages.push({
    role: 'assistant',
    kind: 'code',
    content: `Restored version "${version.label}"`,
    versionId: restored.id,
    ts: Date.now(),
  });
  saveProject(project);
  activateProject(project);
  res.json(project);
});

app.get('/api/projects/:id/export', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${project.id}.zip"`);
  const archive = archiver('zip');
  archive.pipe(res);
  for (const [filePath, content] of Object.entries(project.files)) {
    archive.append(content, { name: filePath });
  }
  archive.append(
    `# ${project.name}\n\nGenerated with Adorable (Lovable clone POC).\n\nFiles use React + Tailwind. Drop src/ into any Vite React template with Tailwind, entry component: src/App.jsx (default export).\n`,
    { name: 'README.md' }
  );
  archive.finalize();
});

app.post('/api/projects/:id/publish', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });
  try {
    const { url } = await publishProject(project);
    project.publishedAt = Date.now();
    saveProject(project);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Adorable server → http://localhost:${PORT}`);
});
