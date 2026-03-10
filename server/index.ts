import cors from 'cors';
import express from 'express';

import { config as appConfig, getSecretsMeta } from './config.js';
import {
  dashscopeTextGenUrl,
  extractTextFromDashScopePayload,
  getDashScopeApiKey,
  makeTextGenerationRequestBody,
  type DashScopeMessage,
} from './dashscope.js';
import multer from 'multer';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  addDoc,
  ensureKbDirs,
  kbDocDir,
  kbRootDir,
  readManifest,
  newDocId,
  type KbDocType,
  updateDoc,
  removeDoc,
} from './kb/store.js';
import { grepWithIdfAndTableAwareness, formatContextsForDisplay } from './kb/grepRetrieval.js';
import { llmDecideSearchToolArgs } from './kb/decision.js';
import { llmExtractKeywords } from './kb/llmKeyword.js';
import { downloadJsonl, getOcrJobStatus, parseJsonlToMarkdownPages, startOcrJobWithPdfBuffer } from './ocr/paddleOcrClient.js';
import { config as globalConfig } from './config.js';
import {
  addDebateDoc,
  debateDocDir,
  debateMarkdownPath,
  newDebateId,
  readDebateManifest,
  removeDebateDocMeta,
} from './debates/store.js';

const app = express();
app.use(cors());
// 辩论存档/判决可能包含较长文本，适当放宽 JSON 体积上限
app.use(express.json({ limit: '5mb' }));

const PORT = appConfig.port;

// 上传落盘（避免 memoryStorage 导致大 PDF 直接 OOM/进程崩溃，从而出现 ERR_CONNECTION_RESET）
const kbTmpDir = path.join(kbRootDir(), 'tmp');
fsSync.mkdirSync(kbTmpDir, { recursive: true });
const upload = multer({ dest: kbTmpDir, limits: { fileSize: globalConfig.kb.uploadMaxBytes } });

type DebateArgument = {
  id: string;
  speakerId: string;
  speakerName: string;
  side: 'PRO' | 'CON';
  text: string;
  timestamp: number;
};

type ModelLang = 'zh-CN' | 'en-US' | 'auto';

type KbConfig = {
  enabled?: boolean;
  selectedDocIds?: string[];
  topK?: number; // 默认 8
  debug?: boolean;
};

function instructionForRole(role: string): string {
  // 与前端原 `AI_INSTRUCTIONS` 对齐（避免质量退化）
  if (role.includes('1st')) {
    return 'You are the 1st speaker. Focus on defining the topic, presenting key logical pillars, and setting a firm foundation for your side. Be formal and structured.';
  }
  if (role.includes('2nd')) {
    return "You are the 2nd speaker. Focus on rebutting the opponent's points directly. Use logic and counter-examples to dismantle their arguments. Be sharp and critical.";
  }
  if (role.includes('3rd')) {
    return 'You are the 3rd speaker. Your job is to summarize the entire debate, weigh the arguments, and show why your side has ultimately won the logic. Be persuasive and high-level.';
  }
  return 'Stay in character as a world-class debater. Be rigorous and persuasive.';
}

function sseHeaders(res: express.Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
}

function sseSend(res: express.Response, data: unknown, event?: string) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function escapeMdText(s: string): string {
  return (s ?? '').replace(/\r\n/g, '\n').trim();
}

function debateToMarkdown(opts: {
  name: string;
  topic: string;
  history: DebateArgument[];
  judgeVerdict?: string;
}) {
  const created = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# ${escapeMdText(opts.name || 'Debate')}`);
  lines.push('');
  lines.push(`- Topic: ${escapeMdText(opts.topic)}`);
  lines.push(`- SavedAt: ${created}`);
  lines.push(`- Turns: ${Array.isArray(opts.history) ? opts.history.length : 0}`);
  lines.push('');
  lines.push('## Transcript');
  lines.push('');
  for (const arg of Array.isArray(opts.history) ? opts.history : []) {
    const who = `${arg.side} - ${arg.speakerName}`;
    const when = arg.timestamp ? new Date(arg.timestamp).toISOString() : '';
    lines.push(`### ${escapeMdText(who)}${when ? ` (${when})` : ''}`);
    lines.push('');
    lines.push(escapeMdText(arg.text || ''));
    lines.push('');
  }
  if (opts.judgeVerdict) {
    lines.push('## Judge Verdict');
    lines.push('');
    lines.push(escapeMdText(opts.judgeVerdict));
    lines.push('');
  }
  return lines.join('\n');
}

function buildDebatePrompt(topic: string, role: string, side: 'PRO' | 'CON', history: DebateArgument[]) {
  const historyText = history
    .map((arg) => `${arg.side} (${arg.speakerName}): ${arg.text}`)
    .join('\n\n');

  return `
Current Debate Topic: ${topic}
Your Side: ${side}
Your Role: ${role}
Instruction: ${instructionForRole(role)}

Debate History:
${historyText}

Please provide your argument. Stay in character as a world-class debater.
Keep your response concise but powerful (around 150-200 words).
Do not use meta-talk. Just provide the speech.
`.trim();
}

async function buildKbContext(opts: {
  query: string;
  lang: ModelLang;
  kb?: KbConfig;
}): Promise<{ context: string; debug?: any }> {
  if (!opts.kb?.enabled) {
    return opts.kb?.debug
      ? { context: '', debug: { ok: false, reason: 'kb_disabled' } }
      : { context: '' };
  }

  const selectedDocIds = Array.isArray(opts.kb.selectedDocIds) ? opts.kb.selectedDocIds : [];
  const targets = selectedDocIds.length ? selectedDocIds.map((id) => `docs/${id}`) : ['docs'];
  const topK = typeof opts.kb.topK === 'number' ? opts.kb.topK : 8;

  // 1) 决策阶段：生成 search_knowledge_base 工具参数（keywords+query 必需）
  const toolArgs = await llmDecideSearchToolArgs({ userQuestion: opts.query, lang: opts.lang });
  const initKeywords = toolArgs?.keywords?.length ? toolArgs.keywords : [];

  // 2) 强制重提关键词（更具体）：失败则回退 initKeywords
  const refined = await llmExtractKeywords({ query: opts.query, lang: opts.lang, minKeywords: 4 });
  const refinedKeywords = refined?.length ? refined : [];
  const finalKeywords = (refinedKeywords.length ? refinedKeywords : initKeywords).slice(0, 12);

  if (!finalKeywords.length) {
    return opts.kb?.debug
      ? {
          context: '',
          debug: {
            ok: false,
            reason: 'no_keywords',
            toolArgsOk: Boolean(toolArgs),
            initKeywords,
            refinedOk: Boolean(refined),
            refinedKeywords,
            queryChars: (opts.query ?? '').length,
            hint:
              '两路关键词都为空：常见原因是 LLM 未按要求输出纯 JSON（解析失败），或关键词被黑名单/数字校验过滤为空，或 query 太短/太泛。',
          },
        }
      : { context: '' };
  }

  // 3) Grep + IDF + table awareness
  const result = await grepWithIdfAndTableAwareness({
    kbRootDir: kbRootDir(),
    targetRelPaths: targets,
    keywords: finalKeywords,
    userQuestion: opts.query,
    topMatches: topK,
  });

  if (!result.snippets.length) {
    return opts.kb?.debug
      ? {
          context: '',
          debug: {
            ok: false,
            reason: 'no_snippets',
            targets,
            finalKeywords,
            scannedFiles: result.scannedFiles,
            matchedLines: result.matchedLines,
            hint:
              result.scannedFiles === 0
                ? 'scannedFiles=0: 目标目录下没有任何 .md（PDF 可能还未产出 content.md）'
                : 'scannedFiles>0 但 matchedLines=0：关键词未命中任何行（可换关键词/检查OCR文本是否异常）',
          },
        }
      : { context: '' };
  }

  const formatted = formatContextsForDisplay(result.snippets);
  if (!formatted) return { context: '' };

  const context =
    opts.lang === 'zh-CN'
      ? `\n\n【知识库检索上下文】（仅供参考；如使用请在回答中尽量引用片段的文件/行号信息）\n${formatted}\n`
      : opts.lang === 'en-US'
        ? `\n\n[Knowledge Base Context] (for reference; if used, cite file/line info from snippets)\n${formatted}\n`
        : `\n\n[Knowledge Base Context / 知识库检索上下文]\n${formatted}\n`;

  const debug = opts.kb?.debug
    ? {
        ok: true,
        targets,
        finalKeywords,
        scannedFiles: result.scannedFiles,
        matchedLines: result.matchedLines,
        // 片段元信息 + 内容预览（避免过长刷爆控制台）
        snippets: result.snippets.map((s) => ({
          relPath: s.relPath,
          lineNumber: s.lineNumber,
          priority: s.priority,
          matchedKeywords: s.matchedKeywords,
          contentPreview:
            s.content.length > 800 ? `${s.content.slice(0, 800)}\n... [truncated] ...` : s.content,
        })),
        // 最终注入到 prompt 的上下文（预览）
        injectedContextChars: context.length,
        injectedContextPreview:
          context.length > 4000 ? `${context.slice(0, 4000)}\n... [truncated] ...` : context,
      }
    : undefined;

  return { context, debug };
}

function buildRetrievalQueryForDebate(topic: string, role: string, history: DebateArgument[]) {
  const h = Array.isArray(history) ? history : [];
  const last = h.length ? h[h.length - 1] : null;

  // 第一位 AI（通常只有 1 条对方发言）→ 用 topic + 对方上一轮
  if (h.length <= 1) {
    const opponent = last?.text?.trim() ? last.text : '';
    return `Topic: ${topic}\nOpponent last point: ${opponent}\nYour role: ${role}\nRespond now.`;
  }

  // 第二位/第三位 AI → 绑入“前面所有内容”（做长度裁剪）
  const historyText = h
    .map((arg) => `${arg.side} (${arg.speakerName}): ${arg.text}`)
    .join('\n\n');

  const maxChars = 6000;
  const clipped = historyText.length > maxChars ? historyText.slice(historyText.length - maxChars) : historyText;

  return `Topic: ${topic}\nYour role: ${role}\nFull debate so far (clipped if long):\n${clipped}\n\nNow respond to the latest opponent points and the overall debate.`;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    dashscopeKeyConfigured: Boolean(globalConfig.dashscopeApiKey),
    kbRootDir: kbRootDir(),
    secrets: getSecretsMeta(),
  });
});

// ---------------------- Debate Archive APIs (Markdown) ----------------------
app.get('/api/debates', async (_req, res) => {
  const m = await readDebateManifest();
  res.json({ ok: true, docs: m.docs });
});

app.post('/api/debates', async (req, res) => {
  try {
    const { name, topic, history, judgeVerdict } = (req.body ?? {}) as {
      name: string;
      topic: string;
      history: DebateArgument[];
      judgeVerdict?: string;
    };

    if (!topic || !Array.isArray(history)) {
      return res.status(400).json({ ok: false, error: 'Missing topic/history' });
    }
    const cleanName = (name || '').trim() || `Debate ${new Date().toLocaleString()}`;

    const debateId = newDebateId();
    await fs.mkdir(debateDocDir(debateId), { recursive: true });

    const md = debateToMarkdown({ name: cleanName, topic, history, judgeVerdict });
    await fs.writeFile(debateMarkdownPath(debateId), md, 'utf-8');

    const meta = await addDebateDoc({
      debateId,
      name: cleanName,
      topic,
      turnCount: history.length,
      hasVerdict: Boolean(judgeVerdict),
    });

    return res.json({ ok: true, debateId, meta });
  } catch (err: any) {
    console.error('[DEBATE_SAVE]', err);
    return res.status(500).json({ ok: false, error: String(err?.message || err || 'save_failed') });
  }
});

app.get('/api/debates/:debateId/markdown', async (req, res) => {
  const debateId = String(req.params.debateId || '');
  if (!debateId) return res.status(400).send('Missing debateId');
  try {
    const md = await fs.readFile(debateMarkdownPath(debateId), 'utf-8');
    res.status(200);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    return res.send(md);
  } catch {
    return res.status(404).send('Not found');
  }
});

app.delete('/api/debates/:debateId', async (req, res) => {
  const debateId = String(req.params.debateId || '');
  if (!debateId) return res.status(400).json({ ok: false, error: 'Missing debateId' });
  const removed = await removeDebateDocMeta(debateId);
  if (!removed) return res.status(404).json({ ok: false, error: 'Not found' });
  await fs.rm(debateDocDir(debateId), { recursive: true, force: true }).catch(() => {});
  return res.json({ ok: true });
});

// ---------------------- Knowledge Base APIs ----------------------
app.get('/api/kb/docs', async (_req, res) => {
  const m = await readManifest();
  res.json({ docs: m.docs });
});

app.get('/api/kb/docs/:docId/debug', async (req, res) => {
  try {
    const { docId } = req.params;
    const docDir = kbDocDir(docId);
    const contentMd = path.join(docDir, 'content.md');
    const sourcePdf = path.join(docDir, 'source.pdf');

    const mdStat = await fs.stat(contentMd).catch(() => null);
    const pdfStat = await fs.stat(sourcePdf).catch(() => null);

    res.json({
      docId,
      docDir,
      contentMd: {
        exists: Boolean(mdStat),
        bytes: mdStat?.size ?? 0,
      },
      sourcePdf: {
        exists: Boolean(pdfStat),
        bytes: pdfStat?.size ?? 0,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Debug failed' });
  }
});

app.delete('/api/kb/docs/:docId', async (req, res) => {
  try {
    const { docId } = req.params;
    const removed = await removeDoc(docId);
    if (!removed) {
      res.status(404).json({ error: 'Doc not found' });
      return;
    }
    // 删除磁盘目录
    const dir = kbDocDir(docId);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Delete failed' });
  }
});

app.post('/api/kb/docs/:docId/ocr/reset', async (req, res) => {
  try {
    const { docId } = req.params;
    const m = await readManifest();
    const doc = m.docs.find((d) => d.docId === docId);
    if (!doc) {
      res.status(404).json({ error: 'Doc not found' });
      return;
    }
    if (doc.type !== 'pdf') {
      res.status(400).json({ error: 'Only PDF can reset OCR state' });
      return;
    }
    await updateDoc(docId, {
      status: 'uploaded',
      ocrJobId: undefined,
      ocrState: undefined,
      ocrErrorMsg: '',
    });
    // 不删除 source.pdf；只清理转换产物
    await fs.rm(path.join(kbDocDir(docId), 'content.md'), { force: true }).catch(() => {});
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Reset failed' });
  }
});

app.post('/api/kb/upload', (req, res) => {
  upload.single('file')(req, res, async (err: any) => {
    if (err) {
      if (err?.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'File too large', maxBytes: globalConfig.kb.uploadMaxBytes });
        return;
      }
      res.status(400).json({ error: String(err?.message || err) });
      return;
    }

    try {
      await ensureKbDirs();
      const f = (req as any).file as Express.Multer.File | undefined;
      if (!f) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const ext = path.extname(f.originalname).toLowerCase();
      const type: KbDocType = ext === '.pdf' ? 'pdf' : ext === '.md' || ext === '.markdown' ? 'md' : 'md';
      if (type !== 'md' && type !== 'pdf') {
        res.status(400).json({ error: 'Unsupported file type. Only .md and .pdf supported.' });
        return;
      }

      // 处理中文文件名乱码：busboy/multer 在部分环境会把 header 参数当 latin1 解码
      const filenameUtf8 = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const filename = /[\u4e00-\u9fff《》]/.test(filenameUtf8) ? filenameUtf8 : f.originalname;

      const meta = await addDoc({
        docId: newDocId(),
        filename,
        type,
        status: 'uploaded',
      });

      const dir = kbDocDir(meta.docId);
      await fs.mkdir(dir, { recursive: true });

      // multer disk 模式：f.path 是临时文件路径
      const tmpPath = f.path;
      const destPath = type === 'md' ? path.join(dir, 'content.md') : path.join(dir, 'source.pdf');
      // 覆盖写入
      await fs.rm(destPath, { force: true }).catch(() => {});
      await fs.rename(tmpPath, destPath);

      res.json({ doc: meta });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Upload failed' });
    }
  });
});

app.post('/api/kb/docs/:docId/convert', async (req, res) => {
  res.status(410).json({
    error: 'Deprecated',
    detail: '已替换为异步 OCR：POST /api/kb/docs/:docId/ocr/start 与 GET /api/kb/docs/:docId/ocr/status',
  });
});

app.post('/api/kb/docs/:docId/ocr/start', async (req, res) => {
  try {
    const { docId } = req.params;
    const m = await readManifest();
    const doc = m.docs.find((d) => d.docId === docId);
    if (!doc) {
      res.status(404).json({ error: 'Doc not found' });
      return;
    }
    if (doc.type !== 'pdf') {
      res.status(400).json({ error: 'Only PDF can be OCR converted' });
      return;
    }

    const pdfPath = path.join(kbDocDir(docId), 'source.pdf');
    const pdf = await fs.readFile(pdfPath);

    const started = await startOcrJobWithPdfBuffer({ filename: doc.filename, pdf });
    await updateDoc(docId, { status: 'converting', ocrJobId: started.jobId, ocrState: 'pending', ocrErrorMsg: '' });

    res.json({ jobId: started.jobId });
  } catch (e: any) {
    const msg = e?.message || 'OCR start failed';
    // 缺少 token / 配置类问题给 400，避免误以为服务端崩了
    if (String(msg).includes('Missing PADDLEOCR_TOKEN')) {
      res.status(400).json({ error: msg });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

app.get('/api/kb/docs/:docId/ocr/status', async (req, res) => {
  try {
    const { docId } = req.params;
    const m = await readManifest();
    const doc = m.docs.find((d) => d.docId === docId);
    if (!doc) {
      res.status(404).json({ error: 'Doc not found' });
      return;
    }
    if (doc.type !== 'pdf') {
      res.status(400).json({ error: 'Only PDF has OCR status' });
      return;
    }
    if (!doc.ocrJobId) {
      res.status(409).json({ error: 'OCR job not started (please click Start OCR first)' });
      return;
    }

    const st = await getOcrJobStatus(doc.ocrJobId);
    await updateDoc(docId, {
      ocrState: st.state,
      ocrErrorMsg: st.errorMsg ?? '',
      status: st.state === 'failed' ? 'failed' : doc.status,
    });

    // done 且尚未生成 content.md：拉取 jsonl 并落盘
    if (st.state === 'done' && st.resultJsonUrl) {
      const docDir = kbDocDir(docId);
      const contentMdPath = path.join(docDir, 'content.md');
      const already = await fs.stat(contentMdPath).then(() => true).catch(() => false);
      if (!already) {
        const jsonl = await downloadJsonl(st.resultJsonUrl);
        const pages = parseJsonlToMarkdownPages(jsonl);

        // 保存图片与合并 markdown
        let merged = '';
        let pageNo = 1;
        for (const p of pages) {
          merged += `\n\n---\n\n## Page ${pageNo}\n\n`;
          merged += p.markdown;

          // markdown.images: path -> url
          for (const [imgPath, url] of Object.entries(p.images ?? {})) {
            const safeRel = imgPath.replaceAll('\\', '/');
            const full = path.join(docDir, safeRel);
            await fs.mkdir(path.dirname(full), { recursive: true });
            const imgResp = await fetch(url);
            if (imgResp.ok) {
              const buf = Buffer.from(await imgResp.arrayBuffer());
              await fs.writeFile(full, buf);
            }
          }
          pageNo += 1;
        }

        await fs.writeFile(contentMdPath, merged.trim() + '\n', 'utf-8');
        await updateDoc(docId, { status: 'converted' });
      }
    }

    res.json({
      state: st.state,
      errorMsg: st.errorMsg,
      extractProgress: st.extractProgress,
      pollIntervalMs: globalConfig.paddleOcr.pollIntervalMs,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'OCR status failed' });
  }
});

app.post('/api/kb/search', async (req, res) => {
  try {
    const { query, keywords, selectedDocIds, topK } = (req.body ?? {}) as {
      query: string;
      keywords: string[];
      selectedDocIds?: string[];
      topK?: number;
    };
    const kbRoot = kbRootDir();
    const targets =
      Array.isArray(selectedDocIds) && selectedDocIds.length
        ? selectedDocIds.map((id) => `docs/${id}`)
        : ['docs'];

    const result = await grepWithIdfAndTableAwareness({
      kbRootDir: kbRoot,
      targetRelPaths: targets,
      keywords: Array.isArray(keywords) ? keywords : [],
      userQuestion: query ?? '',
      topMatches: typeof topK === 'number' ? topK : 8,
    });

    res.json({
      snippets: result.snippets,
      idfWeights: result.idfWeights,
      scannedFiles: result.scannedFiles,
      matchedLines: result.matchedLines,
      formatted: formatContextsForDisplay(result.snippets),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Search failed' });
  }
});
// ----------------------------------------------------------------

// 流式辩论发言：返回 SSE，data: {"text":"..."}（增量片段）
app.post('/api/debate/stream', async (req, res) => {
  sseHeaders(res);

  try {
    const apiKey = getDashScopeApiKey();

    const { topic, role, side, history, lang, kb, freeDebate } = (req.body ?? {}) as {
      topic: string;
      role: string;
      side: 'PRO' | 'CON';
      history: DebateArgument[];
      lang?: ModelLang;
      kb?: KbConfig;
      freeDebate?: {
        kind: 'ai_attack' | 'ai_rebut' | 'ai_reply';
        attackerName?: string;
        targetSpeakerName?: string;
        targetSide?: 'PRO' | 'CON';
      };
    };

    const safeHistory = Array.isArray(history) ? history : [];
    const effectiveLang: ModelLang = lang === 'zh-CN' || lang === 'en-US' ? lang : 'auto';

    const basePrompt = buildDebatePrompt(topic, role, side, safeHistory);
    const freeDebatePrompt =
      freeDebate?.kind === 'ai_attack'
        ? effectiveLang === 'zh-CN'
          ? `
自由辩论模式（AI 主动攻击）：
- 你的身份：${freeDebate.attackerName ?? 'AI'}（反方）
- 你要直接攻击并质询的对象：${freeDebate.targetSpeakerName ?? '对方辩手'}（正方）

要求：
- 用更锋利的交叉质询风格：先指出对方薄弱点，再提出 3-6 个紧凑的问题（可以连问），最后给出一个逼迫对方必须回应的追问。
- 不要复述规则，不要客套，不要元叙事。
`.trim()
          : `
Free debate (AI initiates attack):
- You are: ${freeDebate.attackerName ?? 'AI'} (Con)
- Target to challenge: ${freeDebate.targetSpeakerName ?? 'the opponent speaker'} (Pro)

Requirements:
- Use sharp cross-examination: call out weaknesses, then ask 3-6 tight questions, end with a forcing follow-up.
- No meta talk, no politeness, no rule restatement.
`.trim()
        : freeDebate?.kind === 'ai_rebut'
          ? effectiveLang === 'zh-CN'
            ? `
自由辩论模式（AI 反驳追打）：
- 你刚刚发起了攻击，对方已回应。现在请你反驳对方的回应，并继续追问。

要求：
- 直接点名对方回应中的漏洞/偷换概念/未回答之处（至少 3 点）。
- 每点都给出简短反驳，然后追加 1 个追问，迫使对方落到可检验的承诺上。
`.trim()
            : `
Free debate (AI rebut & press):
- You attacked, the human responded. Now rebut their response and keep pressing.

Requirements:
- Identify at least 3 concrete flaws/evaded questions.
- For each, rebut briefly, then add one follow-up question to force a falsifiable commitment.
`.trim()
          : freeDebate?.kind === 'ai_reply'
            ? effectiveLang === 'zh-CN'
              ? `
自由辩论模式（AI 回应反驳）：
要求：针对对方最新发言进行反驳与追问，尽量具体，避免空泛。
`.trim()
              : `
Free debate (AI reply/rebut):
Requirement: rebut and question the opponent's latest point, be specific, avoid vagueness.
`.trim()
            : '';

    const prompt = freeDebatePrompt ? `${freeDebatePrompt}\n\n${basePrompt}` : basePrompt;

    // 针对本回合构造检索 query（尽量贴近“对方刚说了什么 + 当前任务”）
    const retrievalQuery = buildRetrievalQueryForDebate(topic, role, safeHistory);

    const kbBuilt = await buildKbContext({ query: retrievalQuery, lang: effectiveLang, kb });
    const kbContext = typeof kbBuilt === 'string' ? kbBuilt : kbBuilt.context;
    if (kb && kb.debug && typeof kbBuilt !== 'string' && kbBuilt.debug) {
      sseSend(res, { debug: kbBuilt.debug }, 'kb_debug');
    }

    const formatInstruction =
      effectiveLang === 'zh-CN'
        ? `
请严格按以下格式输出（不要输出其它内容，不要加解释）：
[[THINKING]]
请先输出 THINKING，再输出 SPEECH。
用一段连贯的文字说明你的推理路线（可读、不要暴露详细推理链）。
[[/THINKING]]
[[SPEECH]]
（辩论发言正文）
[[/SPEECH]]
`.trim()
        : effectiveLang === 'en-US'
          ? `
Output strictly in this format (no extra text, no explanations):
[[THINKING]]
You MUST output THINKING first, then SPEECH.
Write ONE coherent paragraph describing your reasoning route (readable; do NOT reveal detailed chain-of-thought).
[[/THINKING]]
[[SPEECH]]
(the debate speech)
[[/SPEECH]]
`.trim()
          : `
Output strictly in this format (no extra text, no explanations):
[[THINKING]]
You MUST output THINKING first, then SPEECH.
Write ONE coherent paragraph describing your reasoning route (readable; do NOT reveal detailed chain-of-thought).
Also, use the same language as the debate topic/opponent messages.
[[/THINKING]]
[[SPEECH]]
(the debate speech)
[[/SPEECH]]
`.trim();

    const messages: DashScopeMessage[] = [
      {
        role: 'system',
        content:
          effectiveLang === 'zh-CN'
            ? '你是世界级辩手。输出必须包含 THINKING 和 发言正文。'
            : effectiveLang === 'en-US'
              ? 'You are a world-class debater. Output MUST include THINKING and the speech.'
              : 'You are a world-class debater. Output MUST include THINKING and the speech. Use the same language as the debate content.',
      },
      { role: 'user', content: `${formatInstruction}\n\n${prompt}${kbContext}` },
    ];

    const upstream = await fetch(dashscopeTextGenUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(
        makeTextGenerationRequestBody({
          model: 'qwen-plus',
          messages,
          temperature: 0.8,
          topP: 0.9,
          stream: true,
        }),
      ),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      sseSend(res, { text: '', error: `DashScope error: ${upstream.status} ${errText}` }, 'error');
      sseSend(res, { done: true }, 'done');
      res.end();
      return;
    }

    // 解析 DashScope SSE：把每个 data: JSON 抽取成 text，再转发给前端
    const reader = upstream.body?.getReader();
    if (!reader) {
      // 兜底：非流式
      const json = await upstream.json().catch(() => null);
      const full = json ? extractTextFromDashScopePayload(json) : '';
      if (full) sseSend(res, { text: full });
      sseSend(res, { done: true }, 'done');
      res.end();
      return;
    }

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE event 以 \n\n 分隔
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const evt of events) {
        const lines = evt.split('\n').map((l) => l.trim());
        const dataLines = lines.filter((l) => l.startsWith('data:'));
        for (const dl of dataLines) {
          const raw = dl.replace(/^data:\s*/, '');
          if (!raw || raw === '[DONE]') continue;
          try {
            const payload = JSON.parse(raw);
            const text = extractTextFromDashScopePayload(payload);
            if (text) sseSend(res, { text });
          } catch {
            // 忽略坏包
          }
        }
      }
    }

    sseSend(res, { done: true }, 'done');
    res.end();
  } catch (e: any) {
    sseSend(res, { text: '', error: e?.message || 'Unknown error' }, 'error');
    sseSend(res, { done: true }, 'done');
    res.end();
  }
});

// 裁判判词：非流式一次性返回
app.post('/api/judge', async (req, res) => {
  try {
    const apiKey = getDashScopeApiKey();
    const { topic, history, lang } = (req.body ?? {}) as {
      topic: string;
      history: DebateArgument[];
      lang?: ModelLang;
    };

    const historyText = (Array.isArray(history) ? history : [])
      .map((arg) => `[${arg.side}] ${arg.speakerName} (${arg.id}): ${arg.text}`)
      .join('\n\n');

    const effectiveLang: ModelLang = lang === 'zh-CN' || lang === 'en-US' ? lang : 'auto';
    const kb = (req.body ?? {})?.kb as KbConfig | undefined;

    const promptZh = `
你是“课堂辩论”的首席法官。辩论已结束。
辩题：“${topic}”

逐字稿：
${historyText}

任务：
请严格依据“逻辑、修辞、反驳有效性、证据/事实支撑”进行评审。输出必须为简体中文，并使用 Markdown。

你必须输出一个“逐个辩手”的量化与质化总结表格，然后给出判决与深度分析。

## 📊 辩手表现总览（必须为表格）
| 辩手 | 队伍 | 优点（要点） | 缺点（要点） | 代表性片段/论点（引用逐字稿） | 评分（0-10） |
| --- | --- | --- | --- | --- | --- |
| Student 1 | 正方 | ... | ... | ... | ... |
| Student 2 | 正方 | ... | ... | ... | ... |
| Student 3 | 正方 | ... | ... | ... | ... |
| AI (Alpha) | 反方 | ... | ... | ... | ... |
| AI (Beta) | 反方 | ... | ... | ... | ... |
| AI (Gamma) | 反方 | ... | ... | ... | ... |

## 🏆 判决结果: [获胜方队伍名称]
给出明确的获胜方，并用 3-6 条 bullet 解释关键胜负手。

## 🌟 全场最佳辩手 (MVP)
**姓名:** ...
**理由:** 必须引用逐字稿中的具体论点或片段支撑。

## 📉 待改进之处（需努力）
**姓名:** ...
**理由:** 指出具体逻辑漏洞/反驳失误/表达问题，并给出 2-3 条改进建议。

## ⚖️ 最终深度分析
以“关键交锋点”为主线，解释为什么赢家赢（不要泛泛而谈），并指出输方如果想翻盘最该补哪三刀。
`.trim();

    const promptEn = `
You are the Chief Justice of a Classroom Debate. The debate has concluded.
Topic: "${topic}"

Transcript:
${historyText}

Task:
Evaluate strictly based on logic, rhetoric, rebuttal effectiveness, and evidence support. Output MUST be in English and use Markdown.

You MUST produce a per-debater table first, then a verdict and deep analysis.

## 📊 Scoreboard (must be a table)
| Debater | Team | Strengths (bullets) | Weaknesses (bullets) | Evidence/Quote from transcript | Score (0-10) |
| --- | --- | --- | --- | --- | --- |
| Student 1 | Pro | ... | ... | ... | ... |
| Student 2 | Pro | ... | ... | ... | ... |
| Student 3 | Pro | ... | ... | ... | ... |
| AI (Alpha) | Con | ... | ... | ... | ... |
| AI (Beta) | Con | ... | ... | ... | ... |
| AI (Gamma) | Con | ... | ... | ... | ... |

## 🏆 Verdict: [Winning team name]
Give a clear winner and 3-6 bullets explaining the key deciding moments.

## 🌟 MVP (Best Debater)
**Name:** ...
**Reason:** MUST cite specific points/quotes from the transcript.

## 📉 Needs Improvement
**Name:** ...
**Reason:** identify concrete logical gaps/missed rebuttals/style issues and give 2-3 actionable improvement tips.

## ⚖️ Final Deep Analysis
Walk through the key clashes and explain precisely why the winner won. Also suggest the top 3 changes the losing team needed to flip the outcome.
`.trim();

    const promptAuto = `
You are the Chief Justice of the Debate Arena. The debate has concluded.
You MUST output in the same language as the transcript.
Use Markdown and follow ONE of the following formats (choose the matching language format, output only one).

--- Chinese Format ---
${promptZh}

--- English Format ---
${promptEn}
`.trim();

    const prompt = effectiveLang === 'zh-CN' ? promptZh : effectiveLang === 'en-US' ? promptEn : promptAuto;
    const kbBuilt = await buildKbContext({
      query: `Topic: ${topic}\nJudge task: final verdict based on transcript.\nTranscript:\n${historyText}`,
      lang: effectiveLang,
      kb,
    });
    const kbContext = typeof kbBuilt === 'string' ? kbBuilt : kbBuilt.context;

    const upstream = await fetch(dashscopeTextGenUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(
        makeTextGenerationRequestBody({
          model: 'qwen-plus',
          messages: [
            {
              role: 'system',
              content:
                effectiveLang === 'zh-CN'
                  ? '你是严谨且公正的辩论裁判。输出只包含判词内容。'
                  : effectiveLang === 'en-US'
                    ? 'You are a strict and fair debate judge. Output ONLY the verdict content.'
                    : 'You are a strict and fair debate judge. Output ONLY the verdict content in the same language as the transcript.',
            },
            { role: 'user', content: prompt + kbContext },
          ],
          temperature: 0.7,
          topP: 0.9,
          stream: false,
        }),
      ),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      res.status(502).json({ error: `DashScope error: ${upstream.status}`, detail: errText });
      return;
    }

    const json = await upstream.json();
    const text = extractTextFromDashScopePayload(json);
    res.json({ text });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

// 语音转写：这里先留接口，避免前端报 CORS；如需阿里语音识别可再接入
app.post('/api/transcribe', async (_req, res) => {
  res.status(501).json({
    error: 'Not implemented',
    detail: '语音转写未接入阿里云语音识别服务；如需要我可以继续补齐。',
  });
});

// ---- Free Debate: auto choose human target for AI attack ----
app.post('/api/free-debate/choose-target', async (req, res) => {
  try {
    const apiKey = getDashScopeApiKey();
    const { topic, history, candidates, attackerName, lang } = (req.body ?? {}) as {
      topic: string;
      history: DebateArgument[];
      candidates: string[];
      attackerName?: string;
      lang?: ModelLang;
    };

    const list = Array.isArray(candidates) ? candidates.filter(Boolean).slice(0, 10) : [];
    if (!topic || !Array.isArray(history) || !list.length) {
      res.status(400).json({ ok: false, error: 'Missing topic/history/candidates' });
      return;
    }

    const historyText = history
      .slice(-30)
      .map((arg) => `[${arg.side}] ${arg.speakerName}: ${arg.text}`)
      .join('\n\n');
    const effectiveLang: ModelLang = lang === 'zh-CN' || lang === 'en-US' ? lang : 'auto';

    const sys =
      effectiveLang === 'zh-CN'
        ? '你是辩论教练。你只输出严格 JSON。'
        : 'You are a debate coach. Output STRICT JSON only.';

    const user =
      effectiveLang === 'zh-CN'
        ? `
这是自由辩论环节。${attackerName ? `攻击者：${attackerName}\n` : ''}辩题：${topic}

逐字稿（截取末尾）：
${historyText}

候选被攻击对象（只能从中选择一个）：
${list.map((x) => `- ${x}`).join('\n')}

任务：选择“最应该被攻击/追问”的那一位（比如：刚刚发言但漏洞最大、回避问题、论证最薄弱、出现明显逻辑跳跃的人）。

只输出如下 JSON（不要 Markdown，不要多余文字）：
{"targetSpeakerName":"<必须完全匹配候选列表之一>","reason":"一句话理由"}
`.trim()
        : `
This is the free debate stage. ${attackerName ? `Attacker: ${attackerName}\n` : ''}Topic: ${topic}

Transcript (tail excerpt):
${historyText}

Candidates (pick exactly one from this list):
${list.map((x) => `- ${x}`).join('\n')}

Task: choose the single best target to attack/press (e.g., just spoke but has the biggest holes, evaded questions, weakest reasoning, logical leaps).

Output STRICT JSON only (no Markdown, no extra text):
{"targetSpeakerName":"<must exactly match one candidate>","reason":"one-sentence reason"}
`.trim();

    const upstream = await fetch(dashscopeTextGenUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(
        makeTextGenerationRequestBody({
          model: 'qwen-plus',
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user },
          ],
          temperature: 0.2,
          topP: 0.8,
          stream: false,
        }),
      ),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      res.status(502).json({ ok: false, error: `DashScope error: ${upstream.status}`, detail: errText });
      return;
    }

    const json = await upstream.json();
    const text = extractTextFromDashScopePayload(json) ?? '';
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m?.[0]) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          parsed = null;
        }
      }
    }

    const chosen = String(parsed?.targetSpeakerName || '').trim();
    const ok = list.includes(chosen);
    const fallback = list[0];

    res.json({
      ok: true,
      targetSpeakerName: ok ? chosen : fallback,
      reason: String(parsed?.reason || '').trim(),
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || 'choose_target_failed' });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT}`);
});


