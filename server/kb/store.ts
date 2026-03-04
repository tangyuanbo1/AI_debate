import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { serverPath } from '../paths.js';

export type KbDocType = 'md' | 'pdf';
export type KbDocStatus = 'uploaded' | 'converting' | 'converted' | 'failed';

export interface KbDocMeta {
  docId: string;
  filename: string;
  type: KbDocType;
  status: KbDocStatus;
  ocrJobId?: string;
  ocrState?: 'pending' | 'running' | 'done' | 'failed';
  ocrErrorMsg?: string;
  createdAt: number;
  updatedAt: number;
  // 约定：
  // - md: content.md 就是 source
  // - pdf: source.pdf 原文件；content.md 是 OCR 后生成（待接入）
}

export interface KbManifest {
  version: number;
  docs: KbDocMeta[];
}

export function kbRootDir(): string {
  // 固定在 server/data/kb，避免云端启动目录(process.cwd)不同导致读写失败
  return serverPath('data', 'kb');
}

export function kbDocsDir(): string {
  return path.join(kbRootDir(), 'docs');
}

export function kbDocDir(docId: string): string {
  return path.join(kbDocsDir(), docId);
}

export function kbManifestPath(): string {
  return path.join(kbRootDir(), 'manifest.json');
}

export async function ensureKbDirs() {
  await fs.mkdir(kbDocsDir(), { recursive: true });
}

export async function readManifest(): Promise<KbManifest> {
  await ensureKbDirs();
  const p = kbManifestPath();
  const raw = await fs.readFile(p, 'utf-8').catch(() => '');
  if (!raw) return { version: 1, docs: [] };
  try {
    const json = JSON.parse(raw);
    if (!json?.docs) return { version: 1, docs: [] };
    return { version: 1, docs: Array.isArray(json.docs) ? json.docs : [] };
  } catch {
    return { version: 1, docs: [] };
  }
}

export async function writeManifest(m: KbManifest) {
  await ensureKbDirs();
  const p = kbManifestPath();
  await fs.writeFile(p, JSON.stringify(m, null, 2), 'utf-8');
}

export function newDocId(): string {
  return crypto.randomBytes(12).toString('hex');
}

export async function addDoc(meta: Omit<KbDocMeta, 'createdAt' | 'updatedAt'>): Promise<KbDocMeta> {
  const now = Date.now();
  const m = await readManifest();
  const full: KbDocMeta = { ...meta, createdAt: now, updatedAt: now };
  m.docs.unshift(full);
  await writeManifest(m);
  return full;
}

export async function updateDoc(docId: string, patch: Partial<KbDocMeta>): Promise<KbDocMeta | null> {
  const m = await readManifest();
  const idx = m.docs.findIndex((d) => d.docId === docId);
  if (idx < 0) return null;
  const next: KbDocMeta = { ...m.docs[idx], ...patch, updatedAt: Date.now() };
  m.docs[idx] = next;
  await writeManifest(m);
  return next;
}


