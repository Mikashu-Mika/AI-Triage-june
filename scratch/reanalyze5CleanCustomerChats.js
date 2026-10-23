import dotenv from 'dotenv';
import { supabase } from '../src/supabase.js';
import { processSingleChat } from '../src/triageService.js';
import { getCachedCategories, getCategoryDisplayName } from '../src/categoryHelper.js';

dotenv.config();

const COMPANY_ID = '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2'; // Mika Co.
const chatIds = [
  'chat-customer-012',
  'chat-customer-013',
  'chat-customer-014',
  'chat-customer-015'
];

async function runReAnalysis() {
  console.log('===============================================================');
  console.log('🔄 เริ่มต้นวิเคราะห์แชทวันนี้ใหม่ (Clean Architecture)');
  console.log('   - Qwen 2.5 14B: วิเคราะห์ปัญหาหลัก + ประเด็นย่อย (detected_issues)');
  console.log('   - BGE-M3: สร้าง Vector Embedding บันทึกลง Supabase');
  console.log('===============================================================\n');

  const categories = await getCachedCategories(COMPANY_ID);

  for (let i = 0; i < chatIds.length; i++) {
    const chatId = chatIds[i];
    console.log(`\n---------------------------------------------------------------`);
    console.log(`[${i + 1}/${chatIds.length}] 🚀 กำลังประมวลผลแชท: ${chatId}...`);
    const start = Date.now();

    try {
      await processSingleChat(chatId);
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`✅ ประมวลผลสำเร็จใน ${duration} วินาที!`);

      // Query updated results from Supabase
      const { data: chat } = await supabase
        .from('chats')
        .select('id, category_id, priority, department, summary, chat_issues(*)')
        .eq('id', chatId)
        .single();

      const catName = getCategoryDisplayName(chat?.category_id, categories);
      console.log(`   📌 หมวดหลัก: ${chat?.category_id} ("${catName}") | แผนก: ${chat?.department} | ด่วน: ${chat?.priority}`);
      console.log(`   📝 สรุป: ${chat?.summary}`);
      console.log(`   🔍 ประเด็นย่อยใน chat_issues (${chat?.chat_issues?.length || 0} เรื่อง จาก Qwen 2.5):`);
      chat?.chat_issues?.forEach((iss, idx) => {
        const issName = getCategoryDisplayName(iss.category_id, categories);
        console.log(`      ${idx + 1}. [${iss.category_id} - ${issName}] (${iss.priority}): "${iss.summary}"`);
      });
    } catch (err) {
      console.error(`❌ ประมวลผล ${chatId} ล้มเหลว:`, err.message);
    }
  }

  console.log('\n===============================================================');
  console.log('🎉 วิเคราะห์แชทใหม่ครบทุกชุดเรียบร้อยสมบูรณ์แล้ว!');
  console.log('===============================================================');
}

runReAnalysis().catch(console.error);
