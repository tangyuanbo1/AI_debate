import { getDashScopeApiKey, dashscopeTextGenUrl, makeTextGenerationRequestBody, extractTextFromDashScopePayload } from '../dashscope.js';
import type { DashScopeMessage } from '../dashscope.js';
import { dropNumericHallucinationKeywords, filterKeywordsByBlacklist } from './keyword.js';

export interface SearchKnowledgeBaseArgs {
  // required
  query: string;
  keywords: string[];
}

// 模拟 lifetrace 的 “LLM 统一决策调用 search_knowledge_base 工具”
export async function llmDecideSearchToolArgs(opts: {
  userQuestion: string;
  lang: 'zh-CN' | 'en-US' | 'auto';
}): Promise<SearchKnowledgeBaseArgs | null> {
  const apiKey = getDashScopeApiKey();

  const schema = `{"query":"<original question>","keywords":["kw1","kw2"]}`;
  let prompt = '';
  if (opts.lang === 'zh-CN') {
    prompt = `你将调用一个工具：search_knowledge_base。
你必须只输出一段 JSON（不要代码块，不要解释），严格符合如下结构：
${schema}

要求：
- query 必须等于用户原始问题（原样）
- keywords 必须是数组，元素为检索关键词（4~8个，尽量具体）
- 避免泛词：如何/什么/软件/标准/流程/方法 等
- 若包含数字/编码，必须来自原问题（不要编造）

用户问题：
${opts.userQuestion}`;
  } else if (opts.lang === 'en-US') {
    prompt = `You will call a tool: search_knowledge_base.
You MUST output ONLY one JSON object (no code fences, no explanation), strictly in this form:
${schema}

Rules:
- query must equal the user's original question verbatim
- keywords must be an array of 4~8 specific search keywords
- Avoid generic words (how/what/software/standard/process/method etc.)
- If any keyword contains numbers/codes, it MUST come from the original question (do not invent)

User question:
${opts.userQuestion}`;
  } else {
    prompt = `You will call a tool: search_knowledge_base.
你将调用一个工具：search_knowledge_base。
You MUST output ONLY one JSON object (no code fences, no explanation). 你必须只输出一段 JSON（不要代码块，不要解释）。
Strict format / 严格格式:
${schema}

Rules / 要求:
- query must equal the user's original question verbatim / query 必须等于用户原始问题（原样）
- keywords must be an array of 4~8 specific search keywords / keywords 为 4~8 个具体检索关键词
- Avoid generic words / 避免泛词（如何/什么/软件/标准...）
- If any keyword contains numbers/codes, it MUST come from the original question / 数字编码必须来自原问题（不要编造）

User question / 用户问题:
${opts.userQuestion}`;
  }

  const messages: DashScopeMessage[] = [
    {
      role: 'system',
      content:
        opts.lang === 'zh-CN'
          ? '你是一个严格的工具调用参数生成器。'
          : opts.lang === 'en-US'
            ? 'You are a strict tool-args generator.'
            : 'You are a strict tool-args generator / 你是一个严格的工具调用参数生成器。',
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

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) return null;
  const slice = text.slice(firstBrace, lastBrace + 1);

  try {
    const obj = JSON.parse(slice) as any;
    const query = String(obj?.query ?? '');
    const keywordsRaw = Array.isArray(obj?.keywords) ? obj.keywords.map((x: any) => String(x)) : [];

    if (!query) return null;
    if (query !== opts.userQuestion) {
      // 强约束：query 必须等于原问题
      return null;
    }

    const cleaned = filterKeywordsByBlacklist(keywordsRaw);
    const noHallucination = dropNumericHallucinationKeywords(cleaned, opts.userQuestion);

    if (!noHallucination.length) return null;
    return { query, keywords: noHallucination };
  } catch {
    return null;
  }
}


