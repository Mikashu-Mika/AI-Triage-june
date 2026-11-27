// Layer 3 of triage, after the 27 Nov review: a customer question is recorded under the company's
// 'other' category with low urgency whatever its topic, and a short statement the LLM read together
// with the one before it keeps the LLM's category. The embedding model is a stub that matches every
// clause to the "game" category with similarity 0.7 (above the 0.55 "other" override, below the 0.78
// override between real categories), so these tests also show the vector match can
// no longer turn a question into a problem.
import { test, mock, before } from 'node:test';
import assert from 'node:assert/strict';

const VEC = [1, 0, 0];
mock.module(new URL('../src/ollama.js', import.meta.url).href, {
  namedExports: {
    getEmbedding: async () => VEC,
    generateTriage: async () => { throw new Error('not used'); },
  },
});

let ensureCompleteSentenceCoverage;
before(async () => {
  ({ ensureCompleteSentenceCoverage } = await import('../src/triageService.js'));
});

const CATS = [
  { id: 'co:deposit_withdrawal', name: 'การเงินและการชำระเงิน' },
  { id: 'co:page_load', name: 'หน้าเว็บค้าง/โหลดช้า' },
  { id: 'co:game', name: 'ปัญหาเกี่ยวกับตัวเกม', embedding: [0.7, 0.714, 0] },
  { id: 'co:other', name: 'เรื่องอื่นๆ' },
];
const run = (conversation, llmIssues) => ensureCompleteSentenceCoverage(conversation, llmIssues, CATS, 'chat-1', 'medium', 'Support');
const issue = (summary, category_id, priority, issue_type) => ({ summary, category_id, priority, department: 'Support', issue_type });

test('a question goes to the other category with low urgency, whatever topic the LLM picked', async () => {
  const out = await run('ลูกค้า: ถอนใช้เวลากี่นาที', [issue('ถอนใช้เวลากี่นาที', 'co:deposit_withdrawal', 'medium', 'question')]);

  assert.equal(out.length, 1);
  assert.equal(out[0].category_id, 'co:other');
  assert.equal(out[0].priority, 'low');
});

test('the vector match cannot turn a question into a problem', async () => {
  const out = await run('ลูกค้า: ตอนนี้เกมอะไรแตก แจกหน่อย', [issue('ตอนนี้เกมอะไรแตก แจกหน่อย', 'co:other', 'low', 'question')]);

  assert.equal(out[0].category_id, 'co:other');
});

test('a question next to a real problem is kept as its own other issue; small talk is not', async () => {
  const conversation = 'ลูกค้า: สวัสดีค่ะ\nลูกค้า: สอบถามเวลาเปิดทำการค่ะ\nลูกค้า: ถอนเงินไม่เข้าบัญชีเลย ด่วนมากค่ะ';
  const out = await run(conversation, [
    issue('สวัสดีค่ะ', 'co:other', 'low', 'chitchat'),
    issue('สอบถามเวลาเปิดทำการค่ะ', 'co:other', 'low', 'question'),
    issue('ถอนเงินไม่เข้าบัญชีเลย ด่วนมากค่ะ', 'co:deposit_withdrawal', 'high', 'problem'),
  ]);

  assert.deepEqual(out.map(i => [i.category_id, i.priority, i.summary]), [
    ['co:other', 'low', 'สอบถามเวลาเปิดทำการค่ะ'],
    ['co:deposit_withdrawal', 'high', 'ถอนเงินไม่เข้าบัญชีเลย ด่วนมากค่ะ'],
  ]);
});

test('a short statement the LLM grouped with the one before keeps the LLM category and urgency', async () => {
  const conversation = 'ลูกค้า: หน้าค้างอยู่แบบนี้ทำไมไม่โหลด ช้ามาก\nลูกค้า: โหลดไม่ไป';
  const out = await run(conversation, [
    issue('หน้าค้างอยู่แบบนี้ทำไมไม่โหลด ช้ามาก โหลดไม่ไป', 'co:page_load', 'high', 'problem'),
  ]);

  assert.equal(out.length, 1, 'both statements end up in one page-load issue, not a separate game issue');
  assert.equal(out[0].category_id, 'co:page_load');
  assert.equal(out[0].priority, 'high');
});

test('an LLM result without issue_type (older prompt) behaves as before', async () => {
  const out = await run('ลูกค้า: ตอนนี้เกมอะไรแตก แจกหน่อย', [issue('ตอนนี้เกมอะไรแตก แจกหน่อย', 'co:other', 'low')]);

  assert.equal(out[0].category_id, 'co:game', 'old rule: the vector may override an LLM "other"');
});
