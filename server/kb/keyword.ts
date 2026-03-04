export type Language = 'zh-CN' | 'en-US';

// 粗粒度清洗：用于“归一化匹配”和“数字幻觉校验”
// 目标：尽量去掉空白/标点，保留字母数字与中文。
export const KW_CLEAN_RE = /[\s`~!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>/?，。！？【】（）《》、：；“”‘’…·]+/g;

const DEFAULT_BLACKLIST = new Set([
  // 中文泛词
  '如何',
  '什么',
  '怎么',
  '为什么',
  '是否',
  '软件',
  '标准',
  '流程',
  '方法',
  '工具',
  '系统',
  '实现',
  '进行',
  '功能',
  '使用',
  '相关',
  '一个',
  '一些',
  // 英文泛词
  'how',
  'what',
  'why',
  'whether',
  'software',
  'standard',
  'process',
  'method',
  'tool',
  'system',
  'implement',
  'use',
  'related',
]);

export function normalizeText(s: string): string {
  return (s ?? '').toLowerCase().replace(KW_CLEAN_RE, '');
}

export function filterKeywordsByBlacklist(keywords: string[], extraBlacklist?: string[]): string[] {
  const bl = new Set(DEFAULT_BLACKLIST);
  (extraBlacklist ?? []).forEach((x) => bl.add(normalizeText(x)));

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of keywords ?? []) {
    const kw = (raw ?? '').trim();
    if (!kw) continue;
    const norm = normalizeText(kw);
    if (!norm) continue;
    if (bl.has(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(kw);
  }
  return out;
}

export function dropNumericHallucinationKeywords(keywords: string[], originalQuery: string): string[] {
  const qNorm = normalizeText(originalQuery ?? '');
  return (keywords ?? []).filter((kw) => {
    const norm = normalizeText(kw);
    if (!norm) return false;
    // 如果包含数字/编码，必须能在原问题中找到对应串
    if (/\d/.test(norm)) {
      return qNorm.includes(norm);
    }
    return true;
  });
}


