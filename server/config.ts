import fs from 'node:fs';
import path from 'node:path';

type Secrets = Partial<Record<string, string>>;

function loadLocalSecrets(): Secrets {
  try {
    const p = path.resolve(process.cwd(), 'server', 'secrets.json');
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf-8');
    const json = JSON.parse(raw);
    return (json && typeof json === 'object') ? (json as Secrets) : {};
  } catch {
    return {};
  }
}

const localSecrets = loadLocalSecrets();

function getSecret(name: string): string {
  // 按你的要求：只从 server/secrets.json 读取（不再读取任何环境变量/.env）
  return localSecrets[name] ?? '';
}

export const config = {
  // 阿里云 DashScope（通义千问）API Key：必须通过环境变量提供
  dashscopeApiKey: getSecret('DASHSCOPE_API_KEY'),

  // 可选：自定义 DashScope Base URL（一般不需要改）
  dashscopeBaseUrl: getSecret('DASHSCOPE_BASE_URL') || 'https://dashscope.aliyuncs.com',

  // 本地后端端口
  port: Number(getSecret('PORT') || 8787),

  // PaddleOCR（异步 Jobs API）
  // 注意：TOKEN 必须通过环境变量提供，绝不要写进代码/提交到 git
  paddleOcr: {
    jobUrl: getSecret('PADDLEOCR_JOB_URL') || 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs',
    token: getSecret('PADDLEOCR_TOKEN'),
    model: getSecret('PADDLEOCR_MODEL') || 'PaddleOCR-VL-1.5',
    optionalPayload: {
      useDocOrientationClassify: (getSecret('PADDLEOCR_USE_DOC_ORIENTATION_CLASSIFY') || 'false') === 'true',
      useDocUnwarping: (getSecret('PADDLEOCR_USE_DOC_UNWARPING') || 'false') === 'true',
      useChartRecognition: (getSecret('PADDLEOCR_USE_CHART_RECOGNITION') || 'false') === 'true',
    },
    pollIntervalMs: Number(getSecret('PADDLEOCR_POLL_INTERVAL_MS') || 5000),
  },

  kb: {
    uploadMaxBytes: Number(getSecret('KB_UPLOAD_MAX_MB') || 100) * 1024 * 1024,
  },
};

export function requireDashScopeApiKey(): string {
  if (!config.dashscopeApiKey) {
    throw new Error('Missing DASHSCOPE_API_KEY (请在 .env 或 server/secrets.json 或部署环境变量中配置)');
  }
  return config.dashscopeApiKey;
}

export function requirePaddleOcrToken(): string {
  if (!config.paddleOcr.token) {
    throw new Error('Missing PADDLEOCR_TOKEN (请在 .env 或 server/secrets.json 或部署环境变量中配置)');
  }
  return config.paddleOcr.token;
}


