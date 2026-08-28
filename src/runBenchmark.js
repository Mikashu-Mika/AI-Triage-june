import { processAgentQuery } from './agentService.js';

const COMPANY_ID = '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2';

const testCases = [
  {
    id: 1,
    name: 'Complaint Query (N-Week Timeframe)',
    query: 'มีแชทร้องเรียนแอดมินไหมใน1สัปดาห์',
    validate: (res) => res.confidence >= 8 && res.reply.includes('ร้องเรียน') && !res.reply.includes('ทั้งหมด')
  },
  {
    id: 2,
    name: 'Percentage Executive Summary Query (August Deposit/Withdrawal)',
    query: 'หมวดหมู่ปัญหาฝาก-ถอนคิดเป็นกี่เปอร์เซ็นต์ของปัญหาทั้งหมดในเดือนสิงหาคม',
    validate: (res) => res.confidence >= 8 && res.reply.includes('สรุปปัญหาแชทเดือนสิงหาคม') && res.reply.includes('คิดเป็น') && !res.excelExport
  },
  {
    id: 3,
    name: 'Deposit/Withdrawal Today Query',
    query: 'ฝาก ถอน เป็นยังไงบ้าง',
    validate: (res) => res.confidence >= 8 && res.reply.includes('ฝาก-ถอนเงิน')
  },
  {
    id: 4,
    name: 'Deposit/Withdrawal Monthly Query',
    query: 'เดือนนี้ ฝาก ถอน เป็นยังไงบ้าง',
    validate: (res) => res.confidence >= 8 && res.reply.includes('สรุปปัญหาแชทเดือนนี้') && res.reply.includes('ฝาก-ถอน')
  },
  {
    id: 5,
    name: 'Daily Peak Analysis Query (Peak Days 1-3)',
    query: 'วันไหนมีปัญหาเยอะที่สุดในเดือนสิงหาคม',
    validate: (res) => res.confidence >= 8 && res.reply.includes('รายงานวันที่มีปัญหาเยอะที่สุด') && res.reply.includes('Peak Day')
  },
  {
    id: 6,
    name: 'Top Problem Category Query (This Week)',
    query: 'ลูกค้าที่แจ้งปัญหาเยอะที่สุดเรื่องอะไร ในสัปดาห์นี้',
    validate: (res) => res.confidence >= 8 && res.reply.includes('สัปดาห์นี้') && res.reply.includes('หมวดหมู่ปัญหาที่พบมากที่สุด')
  },
  {
    id: 7,
    name: 'Dynamic 7-Day Relative Query',
    query: 'สรุปปัญหาย้อนหลัง 7 วัน ปัญหาไหนมีมากที่สุด',
    validate: (res) => res.confidence >= 8 && res.reply.includes('ย้อนหลัง 7 วัน')
  },
  {
    id: 8,
    name: 'Zero Match Specific Category Query',
    query: 'วันนี้มีปัญหาด้านการฝาก-ถอนกี่เคส',
    validate: (res) => res.confidence >= 8 && res.reply.includes('0 กรณี') && res.reply.includes('ไม่พบรายการปัญหาเข้ามาในระบบค่ะ')
  },
  {
    id: 9,
    name: 'VIP Customer Financial Query',
    query: 'มีลูกค้า VIP ทักเข้ามาแจ้งปัญหาเกี่ยวกับการเงินในวันนี้กี่คน',
    validate: (res) => res.confidence >= 8 && (res.reply.includes('ไม่พบข้อมูลตามเงื่อนไขที่ค้นหา') || res.reply.includes('VIP'))
  }
];

async function runAllBenchmarks() {
  console.log('🚀 Running AI Triage Automated Regression Benchmark Suite...\n');
  let passedCount = 0;
  let failedCount = 0;

  for (const tc of testCases) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`🧪 Test #${tc.id}: ${tc.name}`);
    console.log(`📩 Query: "${tc.query}"`);
    let attempt = 0;
    let res = null;
    let duration = 0;
    let isValid = false;

    while (attempt < 2 && !isValid) {
      attempt++;
      const start = Date.now();
      try {
        res = await processAgentQuery(tc.query, COMPANY_ID);
        duration = Date.now() - start;
        isValid = tc.validate(res);
      } catch (err) {
        console.error(`  ⚠️ Attempt ${attempt} failed: ${err.message}`);
      }
    }

    if (isValid) {
      passedCount++;
      console.log(`✅ [PASSED] (${duration}ms) | Confidence: ${res.confidence}/10 | Tool: ${res.toolUsed}`);
      console.log(`📝 Output Sample:\n${res.reply.substring(0, 150).split('\n').map(l => '   | ' + l).join('\n')}...\n`);
    } else {
      failedCount++;
      console.error(`❌ [FAILED] (${duration}ms) | Confidence: ${res ? res.confidence : 0}/10 | Tool: ${res ? res.toolUsed : 'N/A'}`);
      console.error(`📝 Unexpected Output:\n${res ? res.reply.substring(0, 300) : 'No response'}\n`);
    }
  }

  console.log(`================================================================================`);
  console.log(`📊 BENCHMARK SUMMARY RESULTS:`);
  console.log(`  ✅ Passed: ${passedCount} / ${testCases.length}`);
  console.log(`  ❌ Failed: ${failedCount} / ${testCases.length}`);
  console.log(`  🎯 Success Rate: ${Math.round((passedCount / testCases.length) * 100)}%`);
  console.log(`================================================================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllBenchmarks();
