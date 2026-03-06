import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serverPath } from '../paths.js';

export interface DebateDocMeta {
  debateId: string;
  name: string;
  topic: string;
  createdAt: number;
  updatedAt: number;
  turnCount: number;
  hasVerdict: boolean;
}

export interface DebateManifest {
  version: number;
  docs: DebateDocMeta[];
}

export function debateRootDir(): string {
  return serverPath('data', 'debates');
}

export function debateDocsDir(): string {
  return path.join(debateRootDir(), 'docs');
}

export function debateManifestPath(): string {
  return path.join(debateRootDir(), 'manifest.json');
}

export function debateDocDir(debateId: string): string {
  return path.join(debateDocsDir(), debateId);
}

export function debateMarkdownPath(debateId: string): string {
  return path.join(debateDocDir(debateId), 'debate.md');
}

export async function ensureDebateDirs() {
  fsSync.mkdirSync(debateDocsDir(), { recursive: true });
}

export function newDebateId(): string {
  return crypto.randomBytes(12).toString('hex');
}

export async function readDebateManifest(): Promise<DebateManifest> {
  await ensureDebateDirs();
  const p = debateManifestPath();
  const raw = await fs.readFile(p, 'utf-8').catch(() => '');
  if (!raw) return { version: 1, docs: [] };
  try {
    const json = JSON.parse(raw);
    return {
      version: 1,
      docs: Array.isArray(json?.docs) ? (json.docs as DebateDocMeta[]) : [],
    };
  } catch {
    return { version: 1, docs: [] };
  }
}

export async function writeDebateManifest(m: DebateManifest) {
  await ensureDebateDirs();
  const p = debateManifestPath();
  await fs.writeFile(p, JSON.stringify(m, null, 2), 'utf-8');
}

export async function addDebateDoc(meta: Omit<DebateDocMeta, 'createdAt' | 'updatedAt'>): Promise<DebateDocMeta> {
  const now = Date.now();
  const m = await readDebateManifest();
  const full: DebateDocMeta = { ...meta, createdAt: now, updatedAt: now };
  m.docs.unshift(full);
  await writeDebateManifest(m);
  return full;
}

export async function updateDebateDoc(debateId: string, patch: Partial<DebateDocMeta>): Promise<DebateDocMeta | null> {
  const m = await readDebateManifest();
  const idx = m.docs.findIndex((d) => d.debateId === debateId);
  if (idx < 0) return null;
  const next: DebateDocMeta = { ...m.docs[idx], ...patch, updatedAt: Date.now() };
  m.docs[idx] = next;
  await writeDebateManifest(m);
  return next;
}

export async function removeDebateDocMeta(debateId: string): Promise<DebateDocMeta | null> {
  const m = await readDebateManifest();
  const idx = m.docs.findIndex((d) => d.debateId === debateId);
  if (idx < 0) return null;
  const removed = m.docs[idx];
  m.docs.splice(idx, 1);
  await writeDebateManifest(m);
  return removed;
}


