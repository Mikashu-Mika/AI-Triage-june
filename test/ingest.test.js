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

// OneBoxx keeps one chat id for a whole day and resends the growing conversation.
const DAY = [
  'ลูกค้า: เข้าระบบไม่ได้ค่ะ หน้าล็อกอินหมุนตลอด',
  'ลูกค้า: สมัครสมาชิกใหม่ไม่ได้ ขึ้น Invalid Registration Data',
  'ลูกค้า: หน้าเว็บร้านโหลดช้ามาก รูปสินค้าไม่ขึ้น',
  'แอดมิน: .',
];
const quietFor = (chatId, minutes) => {
  const row = chats().find(c => c.id === chatId);
  row.last_ingested_at = new Date(Date.now() - minutes * 60_000).toISOString();
};

test('lines that arrive after the case was quiet for 30 minutes become a new case', async () => {
  await ingest({ id: 'day-1', customer_id: 'cust-1', conversation: DAY.slice(0, 1) });
  await waitFor(() => chats()[0]?.status === 'completed');
  quietFor('day-1', 31);

  const res = await ingest({ id: 'day-1', customer_id: 'cust-1', conversation: DAY.slice(0, 2) });

  assert.equal(res.status, 200);
  assert.equal(res.body.chat_id, 'day-1-part2');
  assert.equal(chats().length, 2);
  const first = chats().find(c => c.id === 'day-1');
  const second = chats().find(c => c.id === 'day-1-part2');
  assert.equal(first.conversation, DAY[0], 'the first case keeps only its own lines');
  assert.equal(first.status, 'completed', 'the first case keeps its result');
  assert.equal(second.conversation, DAY[1], 'the new case has only the new lines');
  assert.equal(second.source_id, 'day-1');
  assert.equal(second.source_offset, 1);
  await waitFor(() => t.triaged.length === 2);
  assert.deepEqual(t.triaged, ['day-1', 'day-1-part2']);
});

test('lines that arrive within 30 minutes extend the latest case', async () => {
  await ingest({ id: 'day-2', customer_id: 'cust-1', conversation: DAY.slice(0, 1) });
  await waitFor(() => chats()[0]?.status === 'completed');
  quietFor('day-2', 10);

  const res = await ingest({ id: 'day-2', customer_id: 'cust-1', conversation: DAY.slice(0, 2) });

  assert.equal(res.body.chat_id, 'day-2');
  assert.equal(chats().length, 1);
  assert.equal(chats()[0].conversation, DAY.slice(0, 2).join('\n'));
});

test('a whole day under one id splits at each quiet gap, and later resends go to the newest case', async () => {
  await ingest({ id: 'day-3', customer_id: 'cust-1', conversation: DAY.slice(0, 1) });
  await waitFor(() => chats()[0]?.status === 'completed');
  quietFor('day-3', 60);
  await ingest({ id: 'day-3', customer_id: 'cust-1', conversation: DAY.slice(0, 2) });
  await waitFor(() => chats().find(c => c.id === 'day-3-part2')?.status === 'completed');
  quietFor('day-3-part2', 300);
  await ingest({ id: 'day-3', customer_id: 'cust-1', conversation: DAY.slice(0, 3) });
  await waitFor(() => chats().find(c => c.id === 'day-3-part3')?.status === 'completed');

  // the admin reply a few minutes later belongs to the third case
  const res = await ingest({ id: 'day-3', customer_id: 'cust-1', conversation: DAY });
  assert.equal(res.body.chat_id, 'day-3-part3');

  assert.deepEqual(chats().map(c => [c.id, c.conversation]), [
    ['day-3', DAY[0]],
    ['day-3-part2', DAY[1]],
    ['day-3-part3', DAY.slice(2).join('\n')],
  ]);

  // resending the same full conversation changes nothing
  await waitFor(() => chats().find(c => c.id === 'day-3-part3')?.status === 'completed');
  const again = await ingest({ id: 'day-3', customer_id: 'cust-1', conversation: DAY });
  assert.equal(again.body.triage_queued, false);
  assert.equal(chats().length, 3);
});

test('CHAT_SPLIT_GAP_MINUTES=0 keeps one case per chat id', async () => {
  process.env.CHAT_SPLIT_GAP_MINUTES = '0';
  try {
    await ingest({ id: 'day-4', customer_id: 'cust-1', conversation: DAY.slice(0, 1) });
    await waitFor(() => chats()[0]?.status === 'completed');
    quietFor('day-4', 600);
    const res = await ingest({ id: 'day-4', customer_id: 'cust-1', conversation: DAY.slice(0, 2) });
    assert.equal(res.body.chat_id, 'day-4');
    assert.equal(chats().length, 1);
  } finally {
    delete process.env.CHAT_SPLIT_GAP_MINUTES;
  }
});

test('a chat saved before splitting existed (no source columns) can still split', async () => {
  t.fake.db.tables.chats.push({ id: 'old-1', company_id: COMPANY.id, customer_id: 'cust-1', conversation: DAY[0], status: 'completed', created_at: '2026-11-27T03:40:00Z' });

  const res = await ingest({ id: 'old-1', customer_id: 'cust-1', conversation: DAY.slice(0, 2) });

  assert.equal(res.body.chat_id, 'old-1-part2');
  assert.equal(chats().find(c => c.id === 'old-1').conversation, DAY[0]);
});
