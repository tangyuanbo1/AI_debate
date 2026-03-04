import { config, requirePaddleOcrToken } from '../config.js';

export type PaddleOcrJobState = 'pending' | 'running' | 'done' | 'failed';

export interface PaddleOcrJobStatus {
  jobId: string;
  state: PaddleOcrJobState;
  errorMsg?: string;
  extractProgress?: {
    totalPages?: number;
    extractedPages?: number;
    startTime?: string;
    endTime?: string;
  };
  resultJsonUrl?: string;
}

export interface PaddleOcrStartResult {
  jobId: string;
}

function authHeaders() {
  const token = requirePaddleOcrToken();
  return {
    Authorization: `bearer ${token}`,
  };
}

export async function startOcrJobWithPdfBuffer(opts: { filename: string; pdf: Buffer }) {
  const jobUrl = config.paddleOcr.jobUrl;
  const model = config.paddleOcr.model;

  const form = new FormData();
  form.append('file', new Blob([opts.pdf]), opts.filename);
  form.append('model', model);
  form.append('optionalPayload', JSON.stringify(config.paddleOcr.optionalPayload));

  const resp = await fetch(jobUrl, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`PaddleOCR start job failed: ${resp.status} ${text}`);
  }

  const json = (await resp.json().catch(() => null)) as any;
  const jobId = json?.data?.jobId;
  if (!jobId) throw new Error('PaddleOCR start job: missing data.jobId');
  return { jobId } as PaddleOcrStartResult;
}

export async function getOcrJobStatus(jobId: string): Promise<PaddleOcrJobStatus> {
  const jobUrl = config.paddleOcr.jobUrl;
  const resp = await fetch(`${jobUrl}/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`PaddleOCR job status failed: ${resp.status} ${text}`);
  }
  const json = (await resp.json().catch(() => null)) as any;
  const data = json?.data ?? {};
  const state = data?.state as PaddleOcrJobState;

  return {
    jobId,
    state,
    errorMsg: data?.errorMsg,
    extractProgress: data?.extractProgress,
    resultJsonUrl: data?.resultUrl?.jsonUrl,
  };
}

export async function downloadJsonl(jsonUrl: string): Promise<string> {
  const resp = await fetch(jsonUrl);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Download jsonl failed: ${resp.status} ${text}`);
  }
  return await resp.text();
}

export interface OcrMarkdownPage {
  markdown: string;
  images: Record<string, string>; // path -> url
  outputImages: Record<string, string>; // name -> url
}

export function parseJsonlToMarkdownPages(jsonlText: string): OcrMarkdownPage[] {
  const pages: OcrMarkdownPage[] = [];
  const lines = (jsonlText ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const result = obj?.result;
    const lprs = result?.layoutParsingResults;
    if (!Array.isArray(lprs)) continue;

    for (const res of lprs) {
      const mdText = res?.markdown?.text;
      if (typeof mdText !== 'string') continue;
      pages.push({
        markdown: mdText,
        images: (res?.markdown?.images && typeof res.markdown.images === 'object') ? res.markdown.images : {},
        outputImages: (res?.outputImages && typeof res.outputImages === 'object') ? res.outputImages : {},
      });
    }
  }
  return pages;
}


