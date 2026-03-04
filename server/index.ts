import cors from 'cors';
import express from 'express';

import { config as appConfig } from './config.js';
import {
  dashscopeTextGenUrl,
  extractTextFromDashScopePayload,
  getDashScopeApiKey,
  makeTextGenerationRequestBody,
  type DashScopeMessage,
} from './dashscope.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = appConfig.port;

type DebateArgument = {
  id: string;
  speakerId: string;
  speakerName: string;
  side: 'PRO' | 'CON';
  text: string;
  timestamp: number;
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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    dashscopeKeyConfigured: Boolean(process.env.DASHSCOPE_API_KEY),
  });
});

// 流式辩论发言：返回 SSE，data: {"text":"..."}（增量片段）
app.post('/api/debate/stream', async (req, res) => {
  sseHeaders(res);

  try {
    const apiKey = getDashScopeApiKey();

    const { topic, role, side, history, lang } = (req.body ?? {}) as {
      topic: string;
      role: string;
      side: 'PRO' | 'CON';
      history: DebateArgument[];
      lang?: 'zh-CN' | 'en-US';
    };

    const prompt = buildDebatePrompt(topic, role, side, Array.isArray(history) ? history : []);
    const targetLang = lang === 'en-US' ? 'en-US' : 'zh-CN';

    const messages: DashScopeMessage[] = [
      {
        role: 'system',
        content:
          targetLang === 'zh-CN'
            ? '你是世界级辩手。请只输出辩词正文，不要输出任何解释。请使用简体中文。'
            : 'You are a world-class debater. Output ONLY the speech content. Use English.',
      },
      { role: 'user', content: prompt },
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
            { role: 'user', content: prompt },
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


