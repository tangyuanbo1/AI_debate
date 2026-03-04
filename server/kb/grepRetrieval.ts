import fs from 'node:fs/promises';
import path from 'node:path';

import { KW_CLEAN_RE, normalizeText, filterKeywordsByBlacklist } from './keyword.js';

export interface GrepMatch {
  filePath: string;
  relPath: string;
  lineNumber: number;
  lineContent: string;
  matchedKeywords: string[];
  priority: number;
}

export interface ContextSnippet {
  fileName: string;
  relPath: string;
  lineNumber: number;
  priority: number;
  matchedKeywords: string[];
  content: string;
}

export interface GrepRetrievalOptions {
  kbRootDir: string;
  targetRelPaths: string[]; // 相对 kbRoot 的目录（可多个）
  keywords: string[];
  userQuestion: string;
  maxScanFiles?: number; // 默认 200
  topMatches?: number; // 默认 8
  contextWindowLines?: number; // 默认 25
  maxContextChars?: number; // 默认 10000
  maxTableChars?: number; // 默认 3000
}

function cleanLineForDisplay(s: string): string {
  return (s ?? '').replace(/\r?\n$/, '');
}

function lineMatchesKeywords(line: string, kws: string[]): string[] {
  const lineClean = cleanLineForDisplay(line);
  const lineLower = lineClean.toLowerCase();
  const lineNormalized = lineLower.replace(KW_CLEAN_RE, '');

  const matched: string[] = [];
  for (const kw of kws) {
    const kwLower = kw.toLowerCase();
    const kwNorm = kwLower.replace(KW_CLEAN_RE, '');
    if (!kwLower || !kwNorm) continue;
    if (lineLower.includes(kwLower) || lineNormalized.includes(kwNorm)) {
      matched.push(kw);
    }
  }
  return matched;
}

async function listAllMdFilesUnder(dirFullPath: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push(p);
      }
    }
  }
  await walk(dirFullPath);
  return out;
}

function extractContextWithTableAwareness(
  lines: string[],
  hitLineNumber: number,
  opts: { contextWindowLines: number; maxTableChars: number },
): string {
  const idx = Math.max(hitLineNumber - 1, 0);

  // 检查是否在 <table> ... </table> 中
  let tableStart = -1;
  for (let i = idx; i >= 0; i--) {
    if (lines[i].toLowerCase().includes('<table')) {
      tableStart = i;
      break;
    }
    // 如果往上遇到 </table>，说明命中行在表外
    if (lines[i].toLowerCase().includes('</table>')) break;
  }

  if (tableStart >= 0) {
    let tableEnd = -1;
    for (let i = tableStart; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes('</table>')) {
        tableEnd = i;
        break;
      }
    }
    if (tableEnd >= 0 && hitLineNumber - 1 >= tableStart && hitLineNumber - 1 <= tableEnd) {
      const tableText = lines.slice(tableStart, tableEnd + 1).join('\n');
      return tableText.length > opts.maxTableChars ? tableText.slice(0, opts.maxTableChars) : tableText;
    }
  }

  const w = opts.contextWindowLines;
  const start = Math.max(0, idx - w);
  const end = Math.min(lines.length, idx + w + 1);
  return lines.slice(start, end).join('\n');
}

export function formatContextsForDisplay(snippets: ContextSnippet[]): string {
  if (!snippets.length) return '';
  return snippets
    .map((s, i) => {
      const header = `### 片段 ${i + 1}\n- 文件: ${s.fileName}\n- 路径: ${s.relPath}\n- 命中行: ${s.lineNumber}\n- 优先级: ${s.priority.toFixed(
        2,
      )}\n- 关键词: ${s.matchedKeywords.join(', ')}`;
      return `${header}\n\n\`\`\`\n${s.content}\n\`\`\`\n`;
    })
    .join('\n');
}

export async function grepWithIdfAndTableAwareness(opts: GrepRetrievalOptions): Promise<{
  snippets: ContextSnippet[];
  idfWeights: Record<string, number>;
  scannedFiles: number;
  matchedLines: number;
}> {
  const maxScanFiles = opts.maxScanFiles ?? 200;
  const topMatches = opts.topMatches ?? 8;
  const contextWindowLines = opts.contextWindowLines ?? 25;
  const maxContextChars = opts.maxContextChars ?? 10000;
  const maxTableChars = opts.maxTableChars ?? 3000;

  const kbRoot = path.resolve(opts.kbRootDir);
  const targetDirs = (opts.targetRelPaths?.length ? opts.targetRelPaths : ['.']).map((p) => path.resolve(kbRoot, p));

  // 关键词清洗门：黑名单 + 去重保序（保留原串用于显示/匹配）
  const keywords = filterKeywordsByBlacklist(opts.keywords ?? []);
  if (!keywords.length) {
    return { snippets: [], idfWeights: {}, scannedFiles: 0, matchedLines: 0 };
  }

  // 收集 md 文件
  let mdFiles: string[] = [];
  for (const d of targetDirs) {
    try {
      const files = await listAllMdFilesUnder(d);
      mdFiles.push(...files);
    } catch {
      // ignore missing dir
    }
  }
  // 去重
  mdFiles = Array.from(new Set(mdFiles));
  mdFiles = mdFiles.slice(0, maxScanFiles);

  const idfSumByKw: Record<string, number> = Object.fromEntries(keywords.map((k) => [k, 0]));
  const allMatches: Omit<GrepMatch, 'priority'>[] = [];
  const fileCache = new Map<string, string[]>();

  for (const f of mdFiles) {
    const raw = await fs.readFile(f, 'utf-8').catch(() => '');
    const lines = raw.split(/\r?\n/);
    const totalLines = Math.max(lines.length, 1);

    const docFreq: Record<string, number> = Object.fromEntries(keywords.map((k) => [k, 0]));
    let fileHasMatch = false;

    for (let i = 0; i < lines.length; i++) {
      const matched = lineMatchesKeywords(lines[i], keywords);
      if (!matched.length) continue;
      fileHasMatch = true;

      allMatches.push({
        filePath: f,
        relPath: path.relative(kbRoot, f).replaceAll('\\', '/'),
        lineNumber: i + 1,
        lineContent: cleanLineForDisplay(lines[i]),
        matchedKeywords: matched,
      });

      for (const kw of matched) docFreq[kw] += 1;
    }

    for (const kw of keywords) {
      const df = docFreq[kw] ?? 0;
      if (df > 0) {
        idfSumByKw[kw] += Math.log(totalLines / df) + 1;
      }
    }

    if (fileHasMatch) {
      fileCache.set(f, lines);
    }
  }

  if (!allMatches.length) {
    return {
      snippets: [],
      idfWeights: Object.fromEntries(keywords.map((k) => [k, 0])),
      scannedFiles: mdFiles.length,
      matchedLines: 0,
    };
  }

  const denom = Math.max(mdFiles.length, 1);
  const idfWeights: Record<string, number> = {};
  for (const kw of keywords) {
    idfWeights[kw] = Math.round((idfSumByKw[kw] / denom) * 100) / 100; // round 2
  }

  const scored: GrepMatch[] = allMatches.map((m) => {
    let p = 0;
    for (const kw of m.matchedKeywords) p += idfWeights[kw] ?? 1.0;

    // 特征加分
    if (/\d{9}/.test(m.lineContent)) p += 5;
    const lc = m.lineContent.toLowerCase();
    if (lc.includes('<table') || lc.includes('<td')) p += 3;

    return { ...m, priority: p };
  });

  const top = scored.sort((a, b) => b.priority - a.priority).slice(0, topMatches);

  const snippets: ContextSnippet[] = [];
  let totalLen = 0;
  for (const m of top) {
    const lines = fileCache.get(m.filePath) ?? [];
    const content = extractContextWithTableAwareness(lines, m.lineNumber, { contextWindowLines, maxTableChars });
    if (!content) continue;
    if (totalLen + content.length > maxContextChars) break;
    totalLen += content.length;
    snippets.push({
      fileName: path.basename(m.filePath),
      relPath: m.relPath,
      lineNumber: m.lineNumber,
      priority: m.priority,
      matchedKeywords: m.matchedKeywords,
      content,
    });
  }

  return { snippets, idfWeights, scannedFiles: mdFiles.length, matchedLines: allMatches.length };
}


