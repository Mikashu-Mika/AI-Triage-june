import { supabase } from './supabase.js';
import { processSingleChat } from './triageService.js';

async function seedChats() {
  console.log('Inserting chat-10128 and chat-10129 to Supabase DB...');

  const companyId = '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2';

  const chatsToInsert = [
    {
      id: 'chat-10128',
      company_id: companyId,
      customer_id: 'cust-002',
      status: 'pending',
      category_id: 'page_load_freeze',
      priority: 'urgent',
      summary: 'ลูกค้าแนบภาพแคปหน้าจอแจ้งปัญหาหน้าเว็บค้าง ติด Error 502 ไม่สามารถเลื่อนหรือกดอะไรได้',
      conversation: 'ลูกค้า: แนบภาพแคปหน้าจอแจ้งปัญหาหน้าเว็บค้าง ติด Error 502 ไม่สามารถเลื่อนหรือกดอะไรได้'
    },
    {
      id: 'chat-10129',
      company_id: companyId,
      customer_id: 'cust-003',
      status: 'completed',
      category_id: 'login_issue',
      priority: 'medium',
      summary: 'ลูกค้าแนบภาพแจ้งเตือนรหัสผ่านผิด ไม่สามารถล็อกอินเข้าสู่ระบบได้ ขึ้นแจ้งเตือนล็อกอินขัดข้อง',
      conversation: 'ลูกค้า: แนบภาพแจ้งเตือนรหัสผ่านผิด ไม่สามารถล็อกอินเข้าสู่ระบบได้ ขึ้นแจ้งเตือนล็อกอินขัดข้อง'
    }
  ];

  for (const chat of chatsToInsert) {
    const { data, error } = await supabase.from('chats').upsert(chat).select();
    if (error) {
      console.error(`Error inserting ${chat.id}:`, error.message);
    } else {
      console.log(`✅ Upserted ${chat.id} into chats table!`);
    }

    try {
      await processSingleChat(chat.id);
      console.log(`✅ Triaged & saved relational issues for ${chat.id}!`);
    } catch (e) {
      console.error(`Error triaging ${chat.id}:`, e.message);
    }
  }

  process.exit(0);
}

seedChats();
