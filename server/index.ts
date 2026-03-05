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

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

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
  lang: 'zh-CN' | 'en-US';
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
      : `\n\n[Knowledge Base Context] (for reference; if used, cite file/line info from snippets)\n${formatted}\n`;

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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    dashscopeKeyConfigured: Boolean(globalConfig.dashscopeApiKey),
    kbRootDir: kbRootDir(),
    secrets: getSecretsMeta(),
  });
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

    const { topic, role, side, history, lang, kb } = (req.body ?? {}) as {
      topic: string;
      role: string;
      side: 'PRO' | 'CON';
      history: DebateArgument[];
      lang?: 'zh-CN' | 'en-US';
      kb?: KbConfig;
    };

    const prompt = buildDebatePrompt(topic, role, side, Array.isArray(history) ? history : []);
    const targetLang = lang === 'en-US' ? 'en-US' : 'zh-CN';

    // 针对本回合构造检索 query（尽量贴近“对方刚说了什么 + 当前任务”）
    const last = Array.isArray(history) && history.length ? history[history.length - 1] : null;
    const retrievalQuery =
      last?.text?.trim()
        ? `Topic: ${topic}\nOpponent last point: ${last.text}\nYour role: ${role}\nRespond now.`
        : `Topic: ${topic}\nYour role: ${role}\nRespond now.`;

    const kbBuilt = await buildKbContext({ query: retrievalQuery, lang: targetLang, kb });
    const kbContext = typeof kbBuilt === 'string' ? kbBuilt : kbBuilt.context;
    if (kb && kb.debug && typeof kbBuilt !== 'string' && kbBuilt.debug) {
      sseSend(res, { debug: kbBuilt.debug }, 'kb_debug');
    }

    const messages: DashScopeMessage[] = [
      {
        role: 'system',
        content:
          targetLang === 'zh-CN'
            ? '你是世界级辩手。请只输出辩词正文，不要输出任何解释。请使用简体中文。'
            : 'You are a world-class debater. Output ONLY the speech content. Use English.',
      },
      { role: 'user', content: prompt + kbContext },
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
      lang?: 'zh-CN' | 'en-US';
    };

    const historyText = (Array.isArray(history) ? history : [])
      .map((arg) => `[${arg.side}] ${arg.speakerName} (${arg.id}): ${arg.text}`)
      .join('\n\n');

    const targetLang = lang === 'en-US' ? 'en-US' : 'zh-CN';
    const kb = (req.body ?? {})?.kb as KbConfig | undefined;

    const promptZh = `
你是“辩论竞技场”的首席法官。辩论已结束。
辩题：“${topic}”

逐字稿：
${historyText}

任务：
请严格依据“逻辑、修辞、反驳有效性”进行评审，输出必须为简体中文，并使用 Markdown，格式如下：

## 🏆 判决结果: [获胜方队伍名称]

### 🌟 全场最佳辩手 (MVP)
**姓名:** [姓名]
**理由:** [举例说明]

### 📉 待改进之处 (需努力)
**姓名:** [姓名]
**理由:** [逻辑漏洞或错失机会]

### ⚖️ 最终深度分析
[详细分析关键交锋点与胜负原因]
`.trim();

    const promptEn = `
You are the Chief Justice of the Debate Arena. The debate has concluded.
Topic: "${topic}"

Transcript:
${historyText}

Task:
Evaluate strictly based on logic, rhetoric, and rebuttal effectiveness. Output MUST be in English and use Markdown with the following format:

## 🏆 Verdict: [Winning team name]

### 🌟 MVP (Best Debater)
**Name:** [Name]
**Reason:** [Explain with examples]

### 📉 Needs Improvement
**Name:** [Name]
**Reason:** [Logical gaps or missed opportunities]

### ⚖️ Final Deep Analysis
[Detailed analysis of key clashes and why the winner won]
`.trim();

    const prompt = targetLang === 'zh-CN' ? promptZh : promptEn;
    const kbBuilt = await buildKbContext({
      query: `Topic: ${topic}\nJudge task: final verdict based on transcript.\nTranscript:\n${historyText}`,
      lang: targetLang,
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
                targetLang === 'zh-CN'
                  ? '你是严谨且公正的辩论裁判。输出只包含判词内容。'
                  : 'You are a strict and fair debate judge. Output ONLY the verdict content.',
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

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT}`);
});


