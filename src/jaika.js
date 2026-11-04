import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const JAIKA_BASE_URL = process.env.JAIKA_BASE_URL;
const JAIKA_API_KEY = process.env.JAIKA_API_KEY;

export const JAIKA_MODEL_CHAT = process.env.JAIKA_MODEL_CHAT || 'qwen2.5-14b';
export const JAIKA_MODEL_FAST = process.env.JAIKA_MODEL_FAST || 'qwen2.5-3b';
export const JAIKA_MODEL_EMBEDDING = process.env.JAIKA_MODEL_EMBEDDING || 'bge-m3';

/**
 * Check if AI Jaika has been configured with a valid URL and API key.
 * If the URL still has placeholder '<company-domain>', it returns false.
 */
export const isJaikaConfigured = () => {
  return !!(
    JAIKA_BASE_URL &&
    JAIKA_API_KEY &&
    !JAIKA_BASE_URL.includes('<company-domain>') &&
    JAIKA_API_KEY.startsWith('sk-jaika-')
  );
};

let jaikaClient = null;

export function getJaikaClient() {
  if (!isJaikaConfigured()) return null;
  if (!jaikaClient) {
    jaikaClient = new OpenAI({
      baseURL: JAIKA_BASE_URL,
      apiKey: JAIKA_API_KEY
    });
  }
  return jaikaClient;
}

/**
 * Chat completion via AI Jaika Platform (OpenAI-compatible)
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ model?: string, format?: object, temperature?: number, maxTokens?: number, timeoutMs?: number }} [options]
 */
export async function jaikaChat(messages, {
  model = JAIKA_MODEL_CHAT,
  format,
  temperature = 0,
  maxTokens = 800,
  timeoutMs = 60000
} = {}) {
  const client = getJaikaClient();
  if (!client) throw new Error('AI Jaika is not configured or domain placeholder not replaced');

  const started = Date.now();
  const params = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens
  };
  if (format && typeof format === 'object') {
    params.response_format = { type: 'json_object' };
  }

  const res = await client.chat.completions.create(params, {
    timeout: timeoutMs
  });

  const choice = res.choices?.[0];
  const content = choice?.message?.content || '';
  const truncated = choice?.finish_reason === 'length' ||
    (res.usage?.completion_tokens != null && res.usage.completion_tokens >= maxTokens);

  return {
    content: content.trim(),
    truncated,
    durationMs: Date.now() - started,
    loadMs: 0,
    promptTokens: res.usage?.prompt_tokens ?? null,
    outputTokens: res.usage?.completion_tokens ?? null
  };
}

/**
 * Generate embedding vector via AI Jaika Platform
 * @param {string} text
 * @param {{ model?: string }} [options]
 * @returns {Promise<number[]>}
 */
export async function jaikaEmbedding(text, { model = JAIKA_MODEL_EMBEDDING } = {}) {
  const client = getJaikaClient();
  if (!client) throw new Error('AI Jaika is not configured or domain placeholder not replaced');

  const res = await client.embeddings.create({
    model,
    input: text
  });

  const vec = res.data?.[0]?.embedding;
  if (!vec || !Array.isArray(vec)) {
    throw new Error('AI Jaika response did not contain embedding vector');
  }
  return vec;
}
