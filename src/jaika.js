import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const JAIKA_BASE_URL = process.env.JAIKA_BASE_URL;
const JAIKA_API_KEY = process.env.JAIKA_API_KEY;

export const JAIKA_MODEL_CHAT = process.env.JAIKA_MODEL_CHAT || 'qwen2.5-14b';
export const JAIKA_MODEL_FAST = process.env.JAIKA_MODEL_FAST || 'qwen2.5-3b';
export const JAIKA_MODEL_EMBEDDING = process.env.JAIKA_MODEL_EMBEDDING || 'bge-m3';

export const getJaikaBaseUrl = () => process.env.JAIKA_BASE_URL || JAIKA_BASE_URL;
export const getJaikaApiKey = () => process.env.JAIKA_API_KEY || JAIKA_API_KEY;

/**
 * Check if AI Jaika has been configured with a valid URL and API key.
 * If the URL still has placeholder '<company-domain>', it returns false.
 */
export const isJaikaConfigured = () => {
  const url = getJaikaBaseUrl();
  const key = getJaikaApiKey();
  return !!(
    url &&
    key &&
    !url.includes('<company-domain>') &&
    key.startsWith('sk-jaika-')
  );
};

/**
 * AI Jaika only runs during set hours (Bangkok time). Outside them every call would
 * just time out, so callers skip straight to the fallback.
 * JAIKA_OPEN_HOURS: "15:00-18:00" (default), several ranges as "09:00-12:00,15:00-18:00",
 * or "always" to ignore the schedule.
 */
const JAIKA_TIMEZONE = 'Asia/Bangkok';

function parseOpenHours(spec) {
  return spec.split(',').map((range) => {
    const m = range.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return { start: +m[1] * 60 + +m[2], end: +m[3] * 60 + +m[4] };
  }).filter(Boolean);
}

function minutesNowInBangkok(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: JAIKA_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const get = (type) => +parts.find((p) => p.type === type).value;
  return get('hour') * 60 + get('minute');
}

export function isJaikaOpenNow(now = new Date()) {
  const spec = (process.env.JAIKA_OPEN_HOURS ?? '15:00-18:00').trim();
  if (!spec || spec.toLowerCase() === 'always') return true;
  const ranges = parseOpenHours(spec);
  if (!ranges.length) {
    console.warn(`⚠️ [AI Jaika] JAIKA_OPEN_HOURS "${spec}" is not valid; treating Jaika as always open.`);
    return true;
  }
  const t = minutesNowInBangkok(now);
  return ranges.some(({ start, end }) => (start <= end ? t >= start && t < end : t >= start || t < end));
}

/** Configured and inside its opening hours: callers should try Jaika first. */
export const isJaikaAvailable = (now = new Date()) =>
  isJaikaConfigured() && (process.env.JAIKA_ONLY === '1' || isJaikaOpenNow(now));

let jaikaClient = null;

export function getJaikaClient() {
  if (!isJaikaConfigured()) return null;
  if (!jaikaClient) {
    jaikaClient = new OpenAI({
      baseURL: getJaikaBaseUrl(),
      apiKey: getJaikaApiKey(),
      // Fail fast to the fallback; the SDK default is 2 retries and a 10-minute timeout.
      maxRetries: 1,
      timeout: 60000
    });
  }
  return jaikaClient;
}

/**
 * Client-side rate limiter, kept under the platform limits (docs: per project 60 requests/min,
 * 100,000 tokens/min, 4 concurrent). The key is shared by the live bot and scripts, so the
 * defaults leave headroom. Requests wait for a slot; if none frees up in time they fail fast
 * and the caller falls back to another model.
 */
const envInt = (name, def) => {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : def;
};
const LIMITS = {
  maxConcurrent: envInt('JAIKA_MAX_CONCURRENT', 2),
  maxRpm: envInt('JAIKA_MAX_RPM', 40),
  maxTpm: envInt('JAIKA_MAX_TPM', 60000),
  minRemaining: envInt('JAIKA_MIN_REMAINING_REQUESTS', 5),
  queueWaitMs: envInt('JAIKA_QUEUE_WAIT_MS', 30000),
};
const WINDOW_MS = 60000;
// How long callers skip Jaika after it fails (e.g. 503 model_unavailable).
export const JAIKA_BACKOFF_MS = envInt('JAIKA_BACKOFF_MS', 10 * 60 * 1000);

let active = 0;
let pausedUntil = 0;
const recent = []; // { at, tokens } for requests started in the last minute

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const estimateTokens = (text) => Math.ceil(text.length / 2); // Thai averages ~2 chars per token

function windowUsage(now) {
  while (recent.length && now - recent[0].at >= WINDOW_MS) recent.shift();
  return { requests: recent.length, tokens: recent.reduce((s, r) => s + r.tokens, 0) };
}

async function acquireSlot(estTokens) {
  const deadline = Date.now() + LIMITS.queueWaitMs;
  for (;;) {
    const now = Date.now();
    const { requests, tokens } = windowUsage(now);
    const fits = active < LIMITS.maxConcurrent && requests < LIMITS.maxRpm &&
      (tokens + estTokens <= LIMITS.maxTpm || requests === 0) && now >= pausedUntil;
    if (fits) {
      active++;
      recent.push({ at: now, tokens: estTokens });
      return;
    }
    if (now >= deadline) throw new Error('AI Jaika local rate limit: no free slot, using fallback');
    const waitForWindow = recent.length ? WINDOW_MS - (now - recent[0].at) : 250;
    await sleep(Math.max(100, Math.min(1000, pausedUntil - now, waitForWindow)));
  }
}

async function withRateLimit(estTokens, call) {
  await acquireSlot(estTokens);
  try {
    const { data, response } = await call();
    // The server's own count also includes other processes using the same key.
    const remaining = parseInt(response?.headers?.get('x-ratelimit-remaining-requests') ?? '', 10);
    if (Number.isFinite(remaining) && remaining <= LIMITS.minRemaining) {
      pausedUntil = Date.now() + WINDOW_MS;
      console.warn(`⚠️ [AI Jaika] Only ${remaining} requests left this minute; pausing Jaika for 60 s.`);
    }
    return data;
  } catch (err) {
    if (err?.status === 429) {
      const retryAfter = parseInt(err.headers?.get?.('retry-after') ?? '', 10);
      pausedUntil = Date.now() + (Number.isFinite(retryAfter) ? retryAfter * 1000 : WINDOW_MS);
    }
    throw err;
  } finally {
    active--;
  }
}

/**
 * JAIKA_ONLY=1 (used by test scripts): never fall back to Cloudflare or the local Ollama.
 * Ignores the opening-hours check and, when Jaika is busy (503/429/timeout/local limit),
 * waits and retries for up to JAIKA_ONLY_MAX_WAIT_MS before giving up with an error.
 */
export const isJaikaOnly = () => process.env.JAIKA_ONLY === '1';

const isRetryable = (err) => [429, 500, 502, 503, 504].includes(err?.status) ||
  /timed? ?out|rate limit|ECONNRESET|fetch failed|connection error/i.test(err?.message || '');

async function withJaikaOnlyRetry(call) {
  if (!isJaikaOnly()) return call();
  const deadline = Date.now() + envInt('JAIKA_ONLY_MAX_WAIT_MS', 5 * 60 * 1000);
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (!isRetryable(err) || Date.now() >= deadline) throw err;
      const waitMs = Math.min(30000, 5000 * attempt);
      console.warn(`⚠️ [AI Jaika only] ${err.message} — retrying Jaika in ${waitMs / 1000}s (attempt ${attempt + 1})`);
      await sleep(waitMs);
    }
  }
}

/** Current limiter state, for logs and tests. */
export function getJaikaRateState() {
  const now = Date.now();
  return { active, ...windowUsage(now), pausedForMs: Math.max(0, pausedUntil - now), limits: { ...LIMITS } };
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

  const promptChars = messages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 2000), 0);
  const res = await withJaikaOnlyRetry(() => withRateLimit(Math.ceil(promptChars / 2) + maxTokens, () =>
    client.chat.completions.create(params, { timeout: timeoutMs }).withResponse()
  ));

  const choice = res.choices?.[0];
  const content = choice?.message?.content || '';
  const truncated = choice?.finish_reason === 'length' ||
    (res.usage?.completion_tokens != null && res.usage.completion_tokens >= maxTokens);

  const durationMs = Date.now() - started;
  console.log(`🟢 [AI Jaika] ${model}: ${res.usage?.prompt_tokens ?? '?'} prompt + ${res.usage?.completion_tokens ?? '?'} output tokens, ${durationMs} ms`);

  return {
    content: content.trim(),
    truncated,
    durationMs,
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

  const res = await withJaikaOnlyRetry(() => withRateLimit(estimateTokens(String(text)), () =>
    client.embeddings.create({ model, input: text }).withResponse()
  ));

  const vec = res.data?.[0]?.embedding;
  if (!vec || !Array.isArray(vec)) {
    throw new Error('AI Jaika response did not contain embedding vector');
  }
  return vec;
}
