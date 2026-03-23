import type { SpeakerRole, DebateSide, Argument } from "../types";

type StreamChunk = { text?: string; done?: boolean; error?: string; debug?: any };

async function* sseToChunks(resp: Response): AsyncGenerator<StreamChunk> {
  const reader = resp.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const evt of events) {
      const lines = evt.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.replace(/^data:\s*/, "");
        if (!raw || raw === "[DONE]") continue;
        try {
          const payload = JSON.parse(raw) as StreamChunk;
          yield payload;
        } catch {
          // ignore
        }
      }
    }
  }
}

export async function generateDebateResponseStream(
  topic: string,
  role: SpeakerRole,
  side: DebateSide,
  history: Argument[],
  lang: 'zh-CN' | 'en-US' | 'auto',
  kb?: { enabled?: boolean; selectedDocIds?: string[]; topK?: number; debug?: boolean },
  extra?: {
    freeDebate?: {
      kind: 'ai_attack' | 'ai_rebut' | 'ai_reply';
      attackerName?: string;
      targetSpeakerName?: string;
      targetSide?: 'PRO' | 'CON';
    };
  }
) {
  const resp = await fetch("/api/debate/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic,
      role,
      side,
      history,
      lang,
      kb,
      ...extra,
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`API error: ${resp.status} ${detail}`);
  }

  // 返回一个 async iterable，兼容 App.tsx 里 `for await`
  return (async function* () {
    for await (const chunk of sseToChunks(resp)) {
      if (chunk?.debug) yield { debug: chunk.debug };
      if (chunk?.text) yield { text: chunk.text };
      if (chunk?.error) throw new Error(chunk.error);
    }
  })();
}

export async function generateJudgeVerdict(
  topic: string,
  history: Argument[],
  lang: 'zh-CN' | 'en-US' | 'auto',
  kb?: { enabled?: boolean; selectedDocIds?: string[]; topK?: number }
) {
  const resp = await fetch("/api/judge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ topic, history, lang, kb }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Judge API error: ${resp.status} ${detail}`);
  }

  const json = (await resp.json()) as { text?: string };
  return json.text ?? "";
}

/** 裁判判词流式 SSE，与辩论流相同 data 格式 */
export async function* generateJudgeVerdictStream(
  topic: string,
  history: Argument[],
  lang: 'zh-CN' | 'en-US' | 'auto',
  kb?: { enabled?: boolean; selectedDocIds?: string[]; topK?: number; debug?: boolean }
): AsyncGenerator<StreamChunk> {
  const resp = await fetch("/api/judge/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ topic, history, lang, kb }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Judge API error: ${resp.status} ${detail}`);
  }

  for await (const chunk of sseToChunks(resp)) {
    yield chunk;
  }
}

export async function transcribeAudio(_base64Audio: string, _mimeType: string): Promise<string> {
  // 这里的原实现依赖 Gemini 多模态；DashScope 的语音识别需要单独接入语音服务。
  // 先返回空字符串，避免前端弹“失败”提示。
  return "";
}

/** 仅当 /api/tts 不存在(404) 时置位，避免反复打无效请求；429/限流不应锁死整页 */
let ttsRouteMissing = false;
let ttsLoggedRouteMissing = false;
let ttsLogged429Hint = false;

/** 同时进行的合成请求数；遇 429/5xx 会在单句内退避重试，不必过小 */
const TTS_MAX_CONCURRENT = 5;
let ttsInFlight = 0;
const ttsWaitQueue: Array<() => void> = [];

function acquireTtsSlot(): Promise<void> {
  if (ttsInFlight < TTS_MAX_CONCURRENT) {
    ttsInFlight += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    ttsWaitQueue.push(() => {
      ttsInFlight += 1;
      resolve();
    });
  });
}

function releaseTtsSlot() {
  ttsInFlight -= 1;
  const next = ttsWaitQueue.shift();
  if (next) next();
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 阿里云 Qwen3-TTS；返回 Blob URL，用完后需 revokeObjectURL。失败返回 null，由界面回退浏览器 TTS。 */
export async function synthesizeSpeech(text: string, lang: 'zh-CN' | 'en-US'): Promise<string | null> {
  if (ttsRouteMissing) return null;
  await acquireTtsSlot();
  try {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, lang }),
      });

      if (resp.ok) {
        const blob = await resp.blob();
        return URL.createObjectURL(blob);
      }

      if (resp.status === 404) {
        ttsRouteMissing = true;
        if (!ttsLoggedRouteMissing) {
          ttsLoggedRouteMissing = true;
          console.warn('[TTS] /api/tts 不存在 (404)，已改用浏览器朗读');
        }
        return null;
      }

      const retryable = resp.status === 429 || (resp.status >= 500 && resp.status < 600);
      if (retryable && attempt < maxAttempts - 1) {
        const backoff =
          resp.status === 429 ? 500 * 2 ** attempt + Math.random() * 200 : 400 + attempt * 300;
        if (resp.status === 429 && !ttsLogged429Hint) {
          ttsLogged429Hint = true;
          console.warn(
            `[TTS] 接口限流 (429)，将自动退避重试（最多 ${maxAttempts} 次/句）；并发上限 ${TTS_MAX_CONCURRENT}`,
          );
        }
        await delay(backoff);
        continue;
      }

      console.warn(`[TTS] /api/tts 失败 HTTP ${resp.status}，本句改用浏览器朗读`);
      return null;
    }
    return null;
  } catch (e) {
    console.warn('[TTS] 请求异常，本句改用浏览器朗读', e);
    return null;
  } finally {
    releaseTtsSlot();
  }
}


