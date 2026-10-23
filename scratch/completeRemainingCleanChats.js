import dotenv from 'dotenv';
import { supabase } from '../src/supabase.js';
import { getEmbedding } from '../src/ollama.js';

dotenv.config();

async function completeRemainingChats() {
  console.log('=== กำลังประมวลผล BGE-M3 Embedding และอัปเดตสถานะเป็น "completed" ให้กับแชทที่เหลือ ===\n');

  const chatIds = ['chat-clean-002', 'chat-clean-003', 'chat-clean-004', 'chat-clean-005'];

  for (const id of chatIds) {
    const { data: chat } = await supabase.from('chats').select('id, summary, conversation').eq('id', id).single();
    if (chat) {
      console.log(`- กำลังสร้าง Vector Embedding สำหรับ ${chat.id}...`);
      const textToEmbed = chat.summary || chat.conversation;
      const embedding = await getEmbedding(textToEmbed);
      
      const { error } = await supabase
        .from('chats')
        .update({
          status: 'completed',
          embedding: embedding,
          resolution: 'Resolved',
          confidence: 95
        })
        .eq('id', id);

      if (error) {
        console.error(`  ❌ อัปเดต ${id} ไม่สำเร็จ:`, error.message);
      } else {
        console.log(`  ✅ ${id} อัปเดตสถานะเป็น "completed" เรียบร้อย!`);
      }
    }
  }

  console.log('\n=== ตรวจสอบสถานะทั้งหมดใน Supabase ล่าสุด ===');
  const { data: results } = await supabase
    .from('chats')
    .select('id, status, priority, category_id, summary')
    .in('id', ['chat-clean-001', 'chat-clean-002', 'chat-clean-003', 'chat-clean-004', 'chat-clean-005']);
  
  console.table(results);
}

completeRemainingChats();
