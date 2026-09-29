import dotenv from 'dotenv';
import { supabase, getCategories } from '../src/supabase.js';
import { generateTriage, getEmbedding } from '../src/ollama.js';

dotenv.config();

async function testSingleTriage() {
  console.log('=== ทดสอบรัน AI Triage ด้วย Qwen 2.5 (14B) + BGE-M3 บน chat-clean-001 ===\n');

  const { data: chat, error: fetchErr } = await supabase
    .from('chats')
    .select('*')
    .eq('id', 'chat-clean-001')
    .single();

  if (fetchErr || !chat) {
    console.error('❌ ไม่พบบทสนทนา chat-clean-001:', fetchErr?.message);
    return;
  }

  console.log('บทสนทนาที่จะนำไปวิเคราะห์:\n', chat.conversation);
  console.log('\n1. กำลังโหลดหมวดหมู่จาก Supabase...');
  const categories = await getCategories();
  console.log(`- โหลดหมวดหมู่มา ${categories.length} หมวด`);

  console.log('\n2. กำลังส่งให้โมเดล Qwen 2.5 (14B) วิเคราะห์...');
  const startTime = Date.now();
  const triageResult = await generateTriage(chat.conversation, categories);
  const triageDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Qwen 2.5 วิเคราะห์เสร็จสิ้นใน ${triageDuration} วินาที!`);
  console.log('ผลลัพธ์จาก AI:', JSON.stringify(triageResult, null, 2));

  console.log('\n3. กำลังสร้าง Vector Embedding ด้วย BGE-M3...');
  const embedStart = Date.now();
  const embedding = await getEmbedding(triageResult.summary || chat.conversation);
  const embedDuration = ((Date.now() - embedStart) / 1000).toFixed(1);
  console.log(`✅ BGE-M3 สร้างเวกเตอร์ ${embedding.length} มิติ เสร็จสิ้นใน ${embedDuration} วินาที!`);

  console.log('\n4. บันทึกผลลัพธ์ AI Triage กลับลง Supabase...');
  const { error: updateErr } = await supabase
    .from('chats')
    .update({
      category_id: triageResult.category_id || chat.category_id,
      priority: triageResult.priority || 'medium',
      summary: triageResult.summary,
      embedding: embedding,
      status: 'completed',
      intent: triageResult.intent,
      root_cause: triageResult.root_cause,
      sentiment: triageResult.sentiment,
      urgency: triageResult.urgency,
      department: triageResult.department,
      keywords: triageResult.keywords,
      recommended_reply: triageResult.recommended_reply
    })
    .eq('id', 'chat-clean-001');

  if (updateErr) {
    console.error('❌ บันทึกผลลง Supabase ไม่สำเร็จ:', updateErr.message);
  } else {
    console.log('✅ บันทึกผลการวิเคราะห์ AI กลับลง Supabase สำเร็จเรียบร้อย (Status: completed)!');
  }
}

testSingleTriage();
