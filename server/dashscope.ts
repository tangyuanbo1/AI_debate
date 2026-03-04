export type DashScopeRole = 'system' | 'user' | 'assistant';

export interface DashScopeMessage {
  role: DashScopeRole;
  content: string;
}

export interface DashScopeChatOptions {
  model: string;
  messages: DashScopeMessage[];
  temperature?: number;
  topP?: number;
  stream?: boolean;
}

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com';
const TEXT_GEN_PATH = '/api/v1/services/aigc/text-generation/generation';

import { config, requireDashScopeApiKey } from './config.js';

export function getDashScopeApiKey(): string {
  return requireDashScopeApiKey();
}

export function getDashScopeBaseUrl(): string {
  return config.dashscopeBaseUrl || DEFAULT_BASE_URL;
}

export function makeTextGenerationRequestBody(opts: DashScopeChatOptions) {
  // 兼容 DashScope 常见的 messages 结构，并开启增量输出（若 stream=true 则走 SSE）。
  return {
    model: opts.model,
    input: {
      messages: opts.messages,
    },
    parameters: {
      result_format: 'message',
      incremental_output: Boolean(opts.stream),
      temperature: opts.temperature ?? 0.8,
      top_p: opts.topP ?? 0.9,
    },
    // 部分文档/版本需要顶层 stream 字段；即使服务忽略也无害
    stream: Boolean(opts.stream),
  };
}

export function dashscopeTextGenUrl(): string {
  return `${getDashScopeBaseUrl()}${TEXT_GEN_PATH}`;
}

export function extractTextFromDashScopePayload(payload: any): string {
  // 尽量兼容不同返回形态（非流式/流式 delta）
  // 常见：
  // - payload.output.text
  // - payload.output.choices[0].message.content
  // - payload.output.choices[0].delta.content
  // - payload.output.choices[0].message.content 可能是 string 或数组
  const out = payload?.output ?? payload;

  const directText = out?.text;
  if (typeof directText === 'string') return directText;

  const choices = out?.choices;
  const c0 = Array.isArray(choices) ? choices[0] : undefined;
  const msgContent = c0?.message?.content ?? c0?.delta?.content;

  if (typeof msgContent === 'string') return msgContent;
  if (Array.isArray(msgContent)) {
    // 有些返回是 [{text:"..."}] 或类似结构
    const parts = msgContent
      .map((p: any) => (typeof p === 'string' ? p : p?.text))
      .filter((x: any) => typeof x === 'string');
    if (parts.length) return parts.join('');
  }

  return '';
}


