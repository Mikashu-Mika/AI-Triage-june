// Triage keeps working when Cloudflare fails: it falls back to local Ollama and skips Cloudflare for a while.
// Cloudflare is a stubbed fetch and Ollama a local HTTP server, so nothing leaves the machine.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let ollama;
let ollamaCalls = [];
let cfCalls = 0;
let cfResponse;
let generateTriage, cloudflareTriageBackoffUntil, resetTriageBackoff;
const realFetch = globalThis.fetch;

const CATEGORIES = [
  { id: 'co:deposit_withdrawal', name: 'การเงิน' },
  { id: 'co:other', name: 'เรื่องอื่นๆ' },
];
const OLLAMA_ANSWER = {
  category_id: 'deposit_withdrawal', summary: 'ถอนเงินไม่เข้า', urgency: 'high', department: 'Finance',
  detected_issues: [{ problem_summary: 'ถอนเงินไม่เข้า', category_id: 'deposit_withdrawal', urgency: 'high', department: 'Finance' }],
};
const QUOTA_BODY = '{"errors":[{"message":"AiError: you have used up your daily free allocation of 10,000 neurons","code":4006}],"success":false}';

before(async () => {
  ollama = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      ollamaCalls.push(JSON.parse(body));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ message: { content: JSON.stringify(OLLAMA_ANSWER) }, prompt_eval_count: 100, eval_count: 50 }));
    });
  });
  await new Promise(r => ollama.listen(0, '127.0.0.1', r));

  // Set before the module loads (dotenv never overrides variables that are already set)
  process.env.OLLAMA_URL = `http://127.0.0.1:${ollama.address().port}`;
  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  process.env.MODEL_LLM = '@cf/qwen/qwen2.5-coder-32b-instruct';
  process.env.OLLAMA_MODEL_LLM = 'qwen2.5:14b';
  process.env.JAIKA_API_KEY = ''; // Jaika off, so the order starts at Cloudflare

  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.cloudflare.com')) { cfCalls++; return cfResponse(); }
    return realFetch(url, init);
  };
  ({ generateTriage, cloudflareTriageBackoffUntil, resetTriageBackoff } = await import('../src/ollama.js'));
});
after(async () => {
  globalThis.fetch = realFetch;
  await new Promise(r => ollama.close(r));
});
beforeEach(() => {
  ollamaCalls = [];
  cfCalls = 0;
  delete process.env.TRIAGE_OLLAMA_FALLBACK;
  resetTriageBackoff();
});

const triage = () => generateTriage('ลูกค้า: ถอนเงินไม่เข้า', CATEGORIES, [], ['ถอนเงินไม่เข้า']);
const quota = () => new Response(QUOTA_BODY, { status: 429 });

test('when Cloudflare is out of daily quota, triage is done by Ollama', async () => {
  cfResponse = quota;
  const r = await triage();

  assert.equal(r.category_id, 'co:deposit_withdrawal');
  assert.equal(r._meta.model, 'ollama:qwen2.5:14b');
  assert.equal(ollamaCalls.length, 1);
  assert.equal(ollamaCalls[0].model, 'qwen2.5:14b', 'Ollama never gets the @cf/ model name');
});

test('after a failure the next chats skip Cloudflare and go straight to Ollama', async () => {
  cfResponse = quota;
  await triage();
  await triage();
  await triage();

  assert.equal(cfCalls, 1);
  assert.equal(ollamaCalls.length, 3);
});

test('a network error or timeout also falls back to Ollama', async () => {
  cfResponse = () => { throw new TypeError('fetch failed'); };
  const r = await triage();

  assert.equal(r._meta.model, 'ollama:qwen2.5:14b');
});

test('when Cloudflare answers, Ollama is not used', async () => {
  cfResponse = () => new Response(JSON.stringify({ result: { response: OLLAMA_ANSWER } }), { status: 200 });
  const r = await triage();

  assert.equal(r._meta.model, '@cf/qwen/qwen2.5-coder-32b-instruct');
  assert.equal(ollamaCalls.length, 0);
});

test('TRIAGE_OLLAMA_FALLBACK=false keeps the old behaviour: the Cloudflare error is thrown', async () => {
  process.env.TRIAGE_OLLAMA_FALLBACK = 'false';
  cfResponse = quota;

  await assert.rejects(triage(), /Cloudflare AI error \(429\)/);
  assert.equal(ollamaCalls.length, 0);
});

test('daily quota waits until 00:00 UTC; other errors wait 10 minutes', () => {
  const now = Date.parse('2026-11-27T03:15:00Z'); // 10:15 in Bangkok

  assert.equal(cloudflareTriageBackoffUntil(429, QUOTA_BODY, now), Date.parse('2026-11-28T00:00:00Z'));
  assert.equal(cloudflareTriageBackoffUntil(429, 'rate limited', now), now + 10 * 60 * 1000);
  assert.equal(cloudflareTriageBackoffUntil(500, 'oops', now), now + 10 * 60 * 1000);
  assert.equal(cloudflareTriageBackoffUntil(0, 'fetch failed', now), now + 10 * 60 * 1000);
});
