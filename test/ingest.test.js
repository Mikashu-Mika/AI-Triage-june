// POST /api/chats/ingest: resending a chat must update it, never duplicate it, and only re-triage when it changed.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, waitFor, settle } from './helpers/startTestApp.js';

const COMPANY = { id: 'company-a', name: 'Company A', client_id: 'client-a', client_secret: 'secret-a', package_tier: 'pro', package_status: 'active', billing_cycle_anchor: 1, created_at: '2026-01-01T00:00:00Z' };
const OTHER = { id: 'company-b', name: 'Company B', client_id: 'client-b', client_secret: 'secret-b', package_tier: 'pro', package_status: 'active', billing_cycle_anchor: 1, created_at: '2026-01-02T00:00:00Z' };
const AUTH = { 'x-client-id': COMPANY.client_id, 'x-client-secret': COMPANY.client_secret };
const FIRST = 'ลูกค้า: สั่งของไปตั้งแต่วันจันทร์ ยังไม่ได้รับเลยค่ะ\nแอดมิน: ขอเลขคำสั่งซื้อหน่อยนะคะ';
const LONGER = FIRST + '\nลูกค้า: ORD-12345 ค่ะ';

let t;
const chats = () => t.fake.db.tables.chats ?? [];
const ingest = (body, headers = AUTH) => t.post('/api/chats/ingest', body, headers);

before(async () => { t = await startTestApp(); });
after(async () => { await t.close(); });
beforeEach(() => {
  t.fake.reset({ companies: [COMPANY, OTHER], chats: [], customers: [], chat_issues: [] });
  t.triaged.length = 0;
});

test('a new chat is saved as pending and sent to the AI once', async () => {
  const res = await ingest({ id: 'chat-1', customer_id: 'cust-1', conversation: FIRST });

  assert.equal(res.status, 200);
  assert.equal(res.body.triage_queued, true);
  assert.equal(res.body.data.status, 'pending');
  assert.equal(chats().length, 1);
  assert.equal(chats()[0].company_id, COMPANY.id);
  await waitFor(() => t.triaged.length === 1);
  assert.deepEqual(t.triaged, ['chat-1']);
  assert.equal((t.fake.db.tables.customers ?? []).length, 1, 'an unknown customer_id creates a customer');
});

test('resending the same id with the same conversation creates no new chat and is not triaged again', async () => {
  await ingest({ id: 'chat-1', customer_id: 'cust-1', conversation: FIRST });
  await waitFor(() => chats()[0]?.status === 'completed');

  const res = await ingest({ id: 'chat-1', customer_id: 'cust-1', conversation: FIRST });
  await settle();

  assert.equal(res.status, 200);
  assert.equal(res.body.triage_queued, false);
  assert.equal(chats().length, 1, 'still one chat');
  assert.equal(chats()[0].status, 'completed', 'the existing result is kept');
  assert.deepEqual(t.triaged, ['chat-1'], 'the AI ran only for the first send');
});

test('resending the same id with a new message replaces the conversation and triages it again', async () => {
  await ingest({ id: 'chat-1', customer_id: 'cust-1', conversation: FIRST });
  await waitFor(() => chats()[0]?.status === 'completed');

  const res = await ingest({ id: 'chat-1', customer_id: 'cust-1', conversation: LONGER });

  assert.equal(res.status, 200);
  assert.equal(res.body.triage_queued, true);
  assert.equal(chats().length, 1, 'still one chat');
  assert.equal(chats()[0].conversation, LONGER, 'the conversation is replaced, not appended');
  await waitFor(() => t.triaged.length === 2);
  assert.deepEqual(t.triaged, ['chat-1', 'chat-1']);
});

test('a conversation sent as an array is joined line by line', async () => {
  const res = await ingest({ id: 'chat-2', customer_id: 'cust-1', conversation: ['ลูกค้า: เข้าแอปไม่ได้', 'แอดมิน: ลองรีเซ็ตรหัสผ่านนะคะ'] });

  assert.equal(res.status, 200);
  assert.equal(chats()[0].conversation, 'ลูกค้า: เข้าแอปไม่ได้\nแอดมิน: ลองรีเซ็ตรหัสผ่านนะคะ');
});

test('an id already used by another company is rejected and left untouched', async () => {
  t.fake.db.tables.chats.push({ id: 'shared-id', company_id: OTHER.id, customer_id: 'x', conversation: 'other company', status: 'completed' });

  const res = await ingest({ id: 'shared-id', customer_id: 'cust-1', conversation: FIRST });
  await settle();

  assert.equal(res.status, 409);
  assert.equal(chats()[0].conversation, 'other company');
  assert.equal(t.triaged.length, 0);
});

test('missing fields give 400 and nothing is saved', async () => {
  const res = await ingest({ id: 'chat-3', customer_id: 'cust-1' });

  assert.equal(res.status, 400);
  assert.equal(chats().length, 0);
});

test('wrong or missing client credentials give 401', async () => {
  const wrong = await ingest({ id: 'chat-4', customer_id: 'c', conversation: 'x' }, { 'x-client-id': COMPANY.client_id, 'x-client-secret': 'wrong' });
  const none = await ingest({ id: 'chat-4', customer_id: 'c', conversation: 'x' }, {});

  assert.equal(wrong.status, 401);
  assert.equal(none.status, 401);
  assert.equal(chats().length, 0);
});

test('malformed JSON gives a JSON 400 and a body over 1mb gives a JSON 413', async () => {
  const bad = await ingest('{"id":', AUTH);
  const big = await ingest({ id: 'chat-5', customer_id: 'c', conversation: 'ก'.repeat(400_000) });

  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'Invalid JSON body.');
  assert.equal(big.status, 413);
  assert.match(big.body.error, /too large/);
});
