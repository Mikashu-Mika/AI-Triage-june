// Starts the bot's Express app against the fake Supabase, on a random port.
// Supabase and the AI triage are replaced with mocks, so no test reaches a real database or AI provider.
// Needs node --experimental-test-module-mocks (see "test" in package.json).
import { mock } from 'node:test';
import { createFakeSupabase } from './fakeSupabase.js';

export const TEST_ADMIN_KEY = 'test-admin-key-0123456789abcdef0123456789';

export async function startTestApp() {
  // Set before the app loads; dotenv never overrides variables that are already set
  process.env.ADMIN_API_KEY = TEST_ADMIN_KEY;
  process.env.SUPABASE_URL = 'http://fake-supabase.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
  process.env.SUPABASE_ANON_KEY = 'fake-anon-key';

  const fake = createFakeSupabase();
  mock.module('@supabase/supabase-js', { exports: { createClient: () => fake } });

  // Every chat sent to the AI is recorded; the "AI" marks it completed like a successful triage would
  const triaged = [];
  const processSingleChat = async (chatId) => {
    triaged.push(chatId);
    const row = (fake.db.tables.chats ?? []).find(c => c.id === chatId);
    if (row) Object.assign(row, { status: 'completed', category_id: 'test:category', summary: 'test summary' });
    return { status: 'completed', chatId };
  };
  mock.module('../../src/triageService.js', {
    exports: { processSingleChat, runTriagePipeline: async () => [] },
  });

  const { app } = await import('../../src/index.js');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    fake,
    triaged,
    baseUrl,
    /** POST JSON and return { status, body, headers }. */
    async post(path, body, headers = {}) {
      const res = await fetch(baseUrl + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
    },
    async get(path, headers = {}) {
      const res = await fetch(baseUrl + path, { headers });
      return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
    },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

/** Waits until check() is truthy (the triage queue runs after the response is sent). */
export async function waitFor(check, timeoutMs = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise(r => setTimeout(r, 10));
  }
}

/** Lets pending async work (such as the triage queue) run before asserting that nothing happened. */
export const settle = () => new Promise(r => setTimeout(r, 50));
