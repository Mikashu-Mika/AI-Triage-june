import dotenv from 'dotenv';
import { supabase } from '../src/supabase.js';

dotenv.config();

async function fixRemaining() {
  console.log('Checking remaining chats with null category_id...');

  const { data: nullChats } = await supabase
    .from('chats')
    .select('id, conversation, summary, category_id')
    .is('category_id', null);

  console.log(`Found ${nullChats.length} chats with null category_id.`);

  if (nullChats.length > 0) {
    for (const chat of nullChats) {
      let assignedCat = 'deposit_withdrawal';
      const text = (chat.conversation || chat.summary || '').toLowerCase();
      
      if (text.includes('ล็อกอิน') || text.includes('รหัส') || text.includes('เข้าไม่ได้') || text.includes('หน้าขาว') || text.includes('โหลด')) {
        assignedCat = 'login_issue';
      } else if (text.includes('โบนัส') || text.includes('โปร') || text.includes('วันเกิด')) {
        assignedCat = 'promo_bonus';
      } else if (text.includes('ถอน') || text.includes('ฝาก') || text.includes('ยอด')) {
        assignedCat = 'deposit_withdrawal';
      }

      console.log(`Assigning fallback category '${assignedCat}' to chat ${chat.id}...`);
      await supabase
        .from('chats')
        .update({ category_id: assignedCat, priority: 'low', status: 'completed' })
        .eq('id', chat.id);
    }
    console.log('All remaining null chats have been populated!');
  } else {
    console.log('Zero chats are null! All chats have valid categories now.');
  }
}

fixRemaining();
