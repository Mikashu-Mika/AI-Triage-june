// Scheduled briefings go to every Telegram group linked to a company in BO, not only one group
// from .env. The send function is a stub, so nothing reaches Telegram.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers/startTestApp.js';

let t;
let getBriefingChatIds, sendToAllBriefingGroups;

before(async () => {
  t = await startTestApp();
  ({ getBriefingChatIds, sendToAllBriefingGroups } = await import('../src/morningScheduler.js'));
});
after(async () => { await t.close(); });
beforeEach(() => {
  t.fake.reset({
    companies: [{ id: 'co-a', name: 'A Co.' }, { id: 'co-b', name: 'B Co.' }],
    telegram_groups: [
      { id: 'g1', chat_id: '-1001', group_name: 'A execs', company_id: 'co-a', is_active: true, created_at: '2026-11-01T00:00:00Z' },
      { id: 'g2', chat_id: '-1002', group_name: 'B execs', company_id: 'co-b', is_active: true, created_at: '2026-11-02T00:00:00Z' },
      { id: 'g3', chat_id: '-1003', group_name: 'not linked', company_id: null, is_active: true, created_at: '2026-11-03T00:00:00Z' },
      { id: 'g4', chat_id: '-1004', group_name: 'switched off', company_id: 'co-a', is_active: false, created_at: '2026-11-04T00:00:00Z' },
    ],
  });
});

test('every active group linked to a company gets the briefing; unlinked and switched-off groups do not', async () => {
  assert.deepEqual((await getBriefingChatIds()).sort(), ['-1001', '-1002']);
});

test('a failure in one group does not stop the others', async () => {
  const sent = [];
  const results = await sendToAllBriefingGroups(async chatId => {
    if (chatId === '-1002') throw new Error('Telegram 403');
    sent.push(chatId);
    return { chatId, sent: true };
  }, 'Test');

  assert.deepEqual(sent, ['-1001']);
  assert.equal(results.length, 2);
  assert.equal(results.find(r => r.chatId === '-1002').error, 'Telegram 403');
});

test('with no linked group nothing is sent', async () => {
  t.fake.reset({ companies: [], telegram_groups: [] });
  let calls = 0;
  const results = await sendToAllBriefingGroups(async () => { calls++; }, 'Test');

  assert.equal(calls, 0);
  assert.deepEqual(results, []);
});
