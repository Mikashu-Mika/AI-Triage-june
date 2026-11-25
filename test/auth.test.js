// POST /api/auth/login (bcrypt, legacy plaintext migration, failed-login limit)
// and POST /api/companies/register (admin key from the X-Admin-Key header only).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, TEST_ADMIN_KEY } from './helpers/startTestApp.js';
import { hashPassword, isBcryptHash } from '../src/password.js';
import { resetLoginLimiter } from '../src/loginLimiter.js';

const TEMPLATE = { id: 'template-co', name: 'Template Co.', domain: 'template.test', client_id: 'client-t', client_secret: 'secret-t', created_at: '2026-01-01T00:00:00Z' };
const CATEGORIES = [
  { id: 'template-co:login_issue', name: 'ปัญหาการเข้าสู่ระบบ', company_id: TEMPLATE.id },
  { id: 'template-co:delivery', name: 'การจัดส่ง', company_id: TEMPLATE.id },
];

let t;
let seed;
const users = () => t.fake.db.tables.users ?? [];
const login = (email, password) => t.post('/api/auth/login', { email, password });

before(async () => {
  t = await startTestApp();
  seed = {
    companies: [TEMPLATE],
    categories: CATEGORIES,
    knowledge_base: [],
    users: [
      { id: 'u-hashed', email: 'hashed@example.test', name: 'Hashed', role: 'agent', company_id: TEMPLATE.id, is_active: true, password: await hashPassword('correct-horse') },
      { id: 'u-legacy', email: 'legacy@example.test', name: 'Legacy', role: 'agent', company_id: TEMPLATE.id, is_active: true, password: 'old-plain-pass' },
      { id: 'u-inactive', email: 'inactive@example.test', name: 'Inactive', role: 'agent', company_id: TEMPLATE.id, is_active: false, password: await hashPassword('correct-horse') },
      { id: 'u-sysadmin', email: 'sysadmin@example.test', name: 'Sys', role: 'system_admin', company_id: null, is_active: true, password: await hashPassword('admin-pass') },
    ],
  };
});
after(async () => { await t.close(); });
beforeEach(() => {
  t.fake.reset(seed);
  resetLoginLimiter();
});

test('login with the right password succeeds and never returns the password', async () => {
  const res = await login('hashed@example.test', 'correct-horse');

  assert.equal(res.status, 200);
  assert.equal(res.body.user.id, 'u-hashed');
  assert.equal(res.body.user.password, undefined);
  assert.equal(res.body.user.company.id, TEMPLATE.id);
});

test('login with a wrong password, an unknown email or an inactive user is rejected', async () => {
  assert.equal((await login('hashed@example.test', 'wrong')).status, 401);
  assert.equal((await login('nobody@example.test', 'correct-horse')).status, 401);
  assert.equal((await login('inactive@example.test', 'correct-horse')).status, 401);
  assert.equal((await t.post('/api/auth/login', { email: 'hashed@example.test' })).status, 400);
});

test('a legacy plaintext password still logs in and is stored as bcrypt afterwards', async () => {
  const first = await login('legacy@example.test', 'old-plain-pass');
  const stored = users().find(u => u.id === 'u-legacy').password;
  const second = await login('legacy@example.test', 'old-plain-pass');

  assert.equal(first.status, 200);
  assert.ok(isBcryptHash(stored), 'password was re-hashed');
  assert.notEqual(stored, 'old-plain-pass');
  assert.equal(second.status, 200, 'the same password works against the new hash');
  assert.equal((await login('legacy@example.test', 'wrong')).status, 401);
});

test('after 5 wrong passwords the account is locked with 429, even for the right password', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login('hashed@example.test', 'wrong')).status, 401);
  const locked = await login('hashed@example.test', 'correct-horse');

  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
});

test('a successful login clears the email count', async () => {
  for (let i = 0; i < 4; i++) await login('hashed@example.test', 'wrong');
  assert.equal((await login('hashed@example.test', 'correct-horse')).status, 200);
  resetLoginLimiter(); // this test is about the email count, not the IP count
  for (let i = 0; i < 4; i++) assert.equal((await login('hashed@example.test', 'wrong')).status, 401);
  assert.equal((await login('hashed@example.test', 'correct-horse')).status, 200);
});

const register = (headers, { query = '', body = { name: 'New Co', domain: 'new.test' } } = {}) =>
  t.post('/api/companies/register' + query, body, headers);

test('register without an admin key, with a wrong key, or with the key outside the header is rejected', async () => {
  assert.equal((await register({})).status, 401);
  assert.equal((await register({ 'x-admin-key': 'wrong-key' })).status, 401);
  assert.equal((await register({}, { query: `?admin_key=${TEST_ADMIN_KEY}` })).status, 401);
  assert.equal((await register({}, { body: { name: 'New Co', domain: 'new.test', admin_key: TEST_ADMIN_KEY } })).status, 401);
  assert.equal((await register({ 'x-user-email': 'hashed@example.test', 'x-user-password': 'correct-horse' })).status, 403, 'a non-admin user is forbidden');
  assert.equal(t.fake.db.tables.companies.length, 1, 'no company was created');
});

test('register with the X-Admin-Key header creates the company and copies the template categories', async () => {
  const res = await register({ 'x-admin-key': TEST_ADMIN_KEY });

  assert.equal(res.status, 200);
  assert.ok(res.body.company.client_id);
  assert.ok(res.body.company.client_secret);
  const created = t.fake.db.tables.companies.find(c => c.id === res.body.company.id);
  assert.equal(created.name, 'New Co');
  const copied = t.fake.db.tables.categories.filter(c => c.company_id === created.id).map(c => c.id).sort();
  assert.deepEqual(copied, [`${created.id}:delivery`, `${created.id}:login_issue`]);
});

test('register also accepts a system_admin user through the credential headers', async () => {
  const res = await register({ 'x-user-email': 'sysadmin@example.test', 'x-user-password': 'admin-pass' });

  assert.equal(res.status, 200);
});
