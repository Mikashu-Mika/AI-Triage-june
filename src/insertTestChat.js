import dotenv from 'dotenv';
import { supabase } from './supabase.js';

dotenv.config();

async function insert() {
  console.log('Inserting a new test chat (chat-004) to verify pgvector Similar Case matching...');
  const { data, error } = await supabase
    .from('chats')
    .insert({
      id: 'chat-004',
      customer_id: 'cust-001',
      conversation: 'ลูกค้า: แอดมินคะ ทำรายการโอนเงินเข้าระบบไปแล้วตั้งแต่เช้า แต่ยอดเครดิตยังไม่ขยับเลยค่ะ ทำไมช้าจัง\nพนักงาน: รบกวนขอใบเสร็จและเวลาโอนด้วยค่ะ',
      status: 'pending'
    })
    .select();

  if (error) {
    console.error('❌ Failed to insert test chat:', error.message);
  } else {
    console.log('✅ Inserted chat-004 successfully!');
  }
}

insert();
