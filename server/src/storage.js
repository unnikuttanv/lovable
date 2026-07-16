// Store selector: Postgres when DATABASE_URL is set, JSON-on-disk otherwise.
const impl = process.env.DATABASE_URL ? await import('./stores/pgStore.js') : await import('./stores/diskStore.js');

export const STORE_KIND = process.env.DATABASE_URL ? 'postgres' : 'disk';
export const { init, listProjects, createProject, getProject, saveProject, deleteProject, getUsage, incrementUsage } = impl;
