// Group roles in Telegram: a listed executive is recorded as executive the first time they
// write in a new group, other people as member, and a role set in BO is never overwritten.
// Messages use _dryRun, so nothing is sent to Telegram.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers/startTestApp.js';

const GROUP = '-100200300';
const COMPANY = { id: 'co-roles', name: 'Roles Co.', domain: 'roles.test', client_id: 'c', client_secret: 's', created_at: '2026-01-01T00:00:00Z' };
const STRANGER = '555000111';

let t;
let handleTelegramMessage;
let EXEC;

before(async () => {
  t = await startTestApp();
  ({ handleTelegramMessage, EXECUTIVE_USER_IDS: [EXEC] } = await import('../src/telegramBot.js'));
});
after(async () => { await t.close(); });
beforeEach(() => {
  t.fake.reset({
    companies: [COMPANY],
    telegram_groups: [{ id: 'g1', chat_id: GROUP, group_name: 'Roles group', company_id: COMPANY.id, is_active: true }],
    telegram_group_members: [],
  });
});

// /briefing_status is answered right after the executive check, without calling the AI
const say = (fromId, text = '/briefing_status') => handleTelegramMessage({
  _dryRun: true,
  chat: { id: Number(GROUP), type: 'group', title: 'Roles group' },
  from: { id: Number(fromId), first_name: 'Test' },
  text,
});
const member = id => t.fake.db.tables.telegram_group_members.filter(m => m.telegram_user_id === String(id));

test("a listed executive's first message in a new group is answered and recorded as executive", async () => {
  const res = await say(EXEC);

  assert.equal(res.ok, true);
  assert.equal(member(EXEC).length, 1);
  assert.equal(member(EXEC)[0].role, 'executive');
});

test('someone not on the list is recorded as member and blocked', async () => {
  const res = await say(STRANGER);

  assert.equal(res.ok, false);
  assert.equal(res.error, 'Restricted: Executive Only in Groups');
  assert.equal(member(STRANGER)[0].role, 'member');
});

test('a role set in BO is kept: a demoted executive stays member and a promoted member stays executive', async () => {
  t.fake.db.tables.telegram_group_members.push(
    { id: 'm1', group_id: GROUP, telegram_user_id: EXEC, role: 'member', is_active: true },
    { id: 'm2', group_id: GROUP, telegram_user_id: STRANGER, role: 'executive', is_active: true },
  );

  assert.equal((await say(EXEC)).ok, false);
  assert.equal((await say(STRANGER)).ok, true);
  assert.equal(member(EXEC).length, 1, 'no duplicate row');
  assert.equal(member(EXEC)[0].role, 'member');
  assert.equal(member(STRANGER)[0].role, 'executive');
});

test('a listed executive added to the group is recorded as executive; re-joining keeps a BO role', async () => {
  const join = id => handleTelegramMessage({
    _dryRun: true,
    chat: { id: Number(GROUP), type: 'group', title: 'Roles group' },
    from: { id: 1, first_name: 'Inviter' },
    new_chat_members: [{ id: Number(id), first_name: 'New', is_bot: false }],
  });

  await join(EXEC);
  await join(STRANGER);
  assert.equal(member(EXEC)[0].role, 'executive');
  assert.equal(member(STRANGER)[0].role, 'member');

  member(STRANGER)[0].role = 'executive';
  await join(STRANGER);
  assert.equal(member(STRANGER)[0].role, 'executive');
});
