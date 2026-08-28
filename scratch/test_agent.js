import { processAgentQuery } from '../src/agentService.js';

async function testAgent() {
  console.log('==================================================');
  console.log('🧪 Starting AI Agent & Tool Calling Tests...');
  console.log('==================================================\n');

  const testQueries = [
    'ช่วง 7 วันที่ผ่านมา ปัญหาอะไรที่ลูกค้าแจ้งเข้ามามากที่สุด?',
    'วันนี้มียอดฝากเงินรวมเท่าไหร่ และมียอดถอนเท่าไหร่ครับ?',
    'โปรโมชั่นวันเกิดมีลูกค้าขอรับไปแล้วกี่คนในเดือนนี้?',
    'สรุปภาพรวมระบบทั้งหมดให้หน่อยครับ'
  ];

  for (const q of testQueries) {
    console.log(`\n💬 User Query: "${q}"`);
    const start = Date.now();
    const result = await processAgentQuery(q);
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    console.log(`🛠️ Tool Used: ${result.toolUsed}`);
    console.log(`⏱️ Duration: ${duration}s`);
    console.log(`🤖 AI Agent Reply:\n${result.reply}`);
    console.log('--------------------------------------------------');
  }

  console.log('\n✅ All AI Agent Tests Completed Successfully!');
}

testAgent();
