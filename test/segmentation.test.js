// Layer 1 of triage: only the customer's own words become clauses (and so can become issues).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentConversationIntoClauses } from '../src/triageService.js';

const clauses = conversation => segmentConversationIntoClauses(conversation).clauses;

test('staff replies and attachment placeholders are not clauses', () => {
  const conversation = [
    'ลูกค้า: ทำไมฝากไปเมื่อเช้ายังไม่เข้า',
    'ลูกค้า: [สติกเกอร์]',
    'แอดมิน: รบกวนรอสักครุ่ระคะ',
    'ลูกค้า: จอเขียว',
    'ลูกค้า: [รูปภาพ]',
    'ลูกค้า: โหลดไม่ไป',
  ].join('\n');

  assert.deepEqual(clauses(conversation), ['ทำไมฝากไปเมื่อเช้ายังไม่เข้า', 'จอเขียว', 'โหลดไม่ไป']);
});

test('every staff label is skipped, in Thai and English', () => {
  const conversation = 'Customer: login failed\nAdmin: please wait\nAgent: checking\nStaff: done\nเจ้าหน้าที่: ตรวจสอบให้แล้วค่ะ\nผู้ใช้: ยังเข้าไม่ได้';

  assert.deepEqual(clauses(conversation), ['login failed', 'ยังเข้าไม่ได้']);
});

test('a line without a label belongs to the previous speaker', () => {
  const conversation = 'ลูกค้า: ถอนเงินไม่เข้า\nแอดมิน: รบกวนรอสักครู่นะคะ\nกำลังตรวจสอบให้ค่ะ\nลูกค้า: รอนานแล้ว\nยังไม่เข้าเลย';

  assert.deepEqual(clauses(conversation), ['ถอนเงินไม่เข้า', 'รอนานแล้ว', 'ยังไม่เข้าเลย']);
});

test('inline labels on one line are split by speaker too', () => {
  const conversation = 'ลูกค้า: สอบถามเวลาเปิดทำการค่ะ แอดมิน: เปิด 8 โมงถึง 5 โมงเย็นค่ะ ลูกค้า: แล้วตอนนี้ถอนเงินไม่เข้าบัญชีเลย ด่วนมากค่ะ';

  assert.deepEqual(clauses(conversation), ['สอบถามเวลาเปิดทำการค่ะ', 'แล้วตอนนี้ถอนเงินไม่เข้าบัญชีเลย ด่วนมากค่ะ']);
});

test('a conversation stored as raw JSON is not mistaken for a placeholder', () => {
  assert.ok(clauses('[{"role":"customer","text":"มีโปรโมชั่นสำหรับสมาชิกใหม่ไหมคะ"}]').length > 0);
});

test('text without labels is still treated as the customer', () => {
  assert.deepEqual(clauses('ล็อกอินไม่ได้'), ['ล็อกอินไม่ได้']);
  assert.deepEqual(clauses('แอดมิน: สวัสดีค่ะ'), [], 'a staff-only chat has no clauses');
});
