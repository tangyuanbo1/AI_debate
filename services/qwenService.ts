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
  kb?: { enabled?: boolean; selectedDocIds?: string[]; topK?: number; debug?: boolean }
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

export async function transcribeAudio(_base64Audio: string, _mimeType: string): Promise<string> {
  // 这里的原实现依赖 Gemini 多模态；DashScope 的语音识别需要单独接入语音服务。
  // 先返回空字符串，避免前端弹“失败”提示。
  return "";
}


