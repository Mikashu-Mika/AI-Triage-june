import { extractIntentAndSlots } from '../src/agentService.js';

const testQueries = [
  'ลูกค้าทั้งหมดมีกี่คน',
  'ลูกค้าทั้งหมดในระบบมีกี่คน',
  'อยากรู้ยอดรวมสมาชิกยูสเซอร์ในระบบตอนนี้มีเท่าไหร่',
  'ตั้งแต่เปิดระบบมา มีคนสมัครกี่รายแล้วมิกะ',
  'วันนี้มีลูกค้าใหม่กี่คน',
  'เมื่อวานนี้มีคนสมัครใหม่กี่คนเหรอ',
  'วันนี้มีปัญหาเข้าหน้าเว็บไม่ได้ ไหม',
  'หมายถึง ปัญหาเข้าหน้าเว็บไม่ได้ มีไหม',
  'มีใครเข้าเว็บไม่ได้บ้างไหมวันนี้',
  'ช่วงเวลาไหนมีปัญหาเยอะที่สุดเมื่อวาน'
];

console.log('==================================================');
console.log('🧪 TESTING DYNAMIC LLM INTENT & SLOT EXTRACTION ENGINE');
console.log('==================================================\n');

testQueries.forEach((q, idx) => {
  const slots = extractIntentAndSlots(q, null);
  console.log(`[#${idx + 1}] Query: "${q}"`);
  console.log(` ├─ Intent       : ${slots.intent}`);
  console.log(` ├─ Period / Label: ${slots.scanPeriodType} (${slots.scanLabel})`);
  console.log(` ├─ Scope        : ${slots.isTotalCustomerQuery ? 'TOTAL_CUSTOMERS (ทั้งหมด)' : 'NEW_CUSTOMERS / GENERAL'}`);
  console.log(` └─ Categories   : [${slots.targetCategories.join(', ') || 'ALL'}]`);
  console.log('--------------------------------------------------');
});

process.exit(0);
