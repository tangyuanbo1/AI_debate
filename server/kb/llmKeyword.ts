import { getDashScopeApiKey, dashscopeTextGenUrl, makeTextGenerationRequestBody, extractTextFromDashScopePayload } from '../dashscope.js';
import type { DashScopeMessage } from '../dashscope.js';
import { dropNumericHallucinationKeywords, filterKeywordsByBlacklist } from './keyword.js';

export async function llmExtractKeywords(opts: {
  query: string;
  lang: 'zh-CN' | 'en-US';
  minKeywords?: number;
}): Promise<string[] | null> {
  const apiKey = getDashScopeApiKey();
  const minKeywords = opts.minKeywords ?? 4;

  const prompt =
    opts.lang === 'zh-CN'
      ? `从下面问题中提取${minKeywords}~8个“检索关键词”，要求：
- 只输出 JSON 数组，例如 ["关键词1","关键词2"]
- 关键词要具体，避免泛词（如何/什么/软件/标准 等）
- 若包含数字/编码，必须来自原问题（不要编造）

问题：
${opts.query}`
      : `Extract ${minKeywords}~8 search keywords from the question below.
Rules:
- Output ONLY a JSON array, e.g. ["kw1","kw2"]
- Be specific; avoid generic words (how/what/software/standard etc.)
- If a keyword contains numbers/codes, it MUST appear in the original question (do not invent).

Question:
${opts.query}`;

  const messages: DashScopeMessage[] = [
    {
      role: 'system',
      content: opts.lang === 'zh-CN' ? '你是一个严谨的信息检索关键词提取器。' : 'You are a strict information retrieval keyword extractor.',
    },
    { role: 'user', content: prompt },
  ];

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
        messages,
        temperature: 0.2,
        topP: 0.9,
        stream: false,
      }),
    ),
  });

  if (!upstream.ok) return null;
  const json = await upstream.json().catch(() => null);
  const text = json ? extractTextFromDashScopePayload(json) : '';
  if (!text) return null;

  // 尝试从输出中提取 JSON 数组
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket < 0 || lastBracket < 0 || lastBracket <= firstBracket) return null;
  const slice = text.slice(firstBracket, lastBracket + 1);

  try {
    const arr = JSON.parse(slice);
    if (!Array.isArray(arr)) return null;
    const kws = arr.map((x) => String(x)).filter(Boolean);
    const cleaned = filterKeywordsByBlacklist(kws);
    const noHallucination = dropNumericHallucinationKeywords(cleaned, opts.query);
    if (noHallucination.length < Math.max(2, Math.floor(minKeywords / 2))) return null;
    return noHallucination;
  } catch {
    return null;
  }
}


