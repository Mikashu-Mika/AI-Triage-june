import http from 'http';
import https from 'https';
import dotenv from 'dotenv';
dotenv.config();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
export const AGENT_MODEL = process.env.MODEL_AGENT || process.env.MODEL_LLM || 'qwen2.5:14b';
const NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || '8192', 10);

/**
 * Call Ollama /api/chat (non-streaming).
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ format?: object, temperature?: number, maxTokens?: number, timeoutMs?: number }} [options]
 * @returns {Promise<{ content: string, promptTokens: number|null, outputTokens: number|null }>}
 */
export function ollamaChat(messages, { format, temperature = 0, maxTokens = 800, timeoutMs = 120000 } = {}) {
  const url = new URL('/api/chat', OLLAMA_URL);
  const body = JSON.stringify({
    model: AGENT_MODEL,
    messages,
    stream: false,
    ...(format ? { format } : {}),
    options: { temperature, num_ctx: NUM_CTX, num_predict: maxTokens }
  });
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Ollama HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
          return;
        }
        try {
          const data = JSON.parse(raw);
          resolve({
            content: (data.message?.content || '').trim(),
            promptTokens: data.prompt_eval_count ?? null,
            outputTokens: data.eval_count ?? null
          });
        } catch (err) {
          reject(new Error(`Invalid Ollama response: ${err.message}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Ollama request timeout (${timeoutMs / 1000}s)`)));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Parse a JSON object out of an LLM reply (tolerates code fences / surrounding text) */
export function parseJsonObject(text) {
  const cleaned = (text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last <= first) throw new Error('No JSON object in LLM output');
  return JSON.parse(cleaned.slice(first, last + 1));
}

/** Remove Chinese / Cyrillic characters Qwen sometimes mixes into Thai output */
export function stripForeignScripts(text) {
  return (text || '')
    .replace(/[一-鿿㐀-䶿豈-﫿Ѐ-ӿ]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
