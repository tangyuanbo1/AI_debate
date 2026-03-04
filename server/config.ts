import 'dotenv/config';

export const config = {
  // 阿里云 DashScope（通义千问）API Key：必须通过环境变量提供
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY ?? '',

  // 可选：自定义 DashScope Base URL（一般不需要改）
  dashscopeBaseUrl: process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com',

  // 本地后端端口
  port: Number(process.env.PORT ?? 8787),
};

export function requireDashScopeApiKey(): string {
  if (!config.dashscopeApiKey) {
    throw new Error('Missing env DASHSCOPE_API_KEY (请在 .env 或部署环境变量中配置)');
  }
  return config.dashscopeApiKey;
}


