import dotenv from 'dotenv';
import { supabase } from '../src/supabase.js';

dotenv.config();

async function debugFilters() {
  const { data: chats } = await supabase
    .from('chats')
    .select('*, chat_issues(*)')
    .eq('company_id', '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2');

  console.log('Total chats from Supabase:', chats.length);

  const missingIds = ['chat-100122', 'chat-100127', 'chat-110802'];
  
  // Step 1: Sort by created_at desc
  const sorted = [...chats].sort((a, b) => 
    new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );

  console.log('Index of missing chats after sort:');
  missingIds.forEach(id => {
    const idx = sorted.findIndex(c => c.id === id);
    console.log(` - ${id}: Index ${idx} in sorted list`);
  });

  // Step 2: Test dateFilter = '7days'
  const now = new Date('2026-08-12T15:09:15+07:00');
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - 7);

  const in7days = sorted.filter(c => c.created_at && new Date(c.created_at) >= cutoff);
  console.log('\nin7days count:', in7days.length);

  missingIds.forEach(id => {
    const in7 = in7days.some(c => c.id === id);
    console.log(` - ${id} in 7days filter: ${in7}`);
  });

  // Let's print all 27 items in 7days filter to see their IDs and timestamps!
  console.log('\nAll 27 items in 7days filter (in order):');
  in7days.forEach((c, i) => {
    console.log(`${i + 1}. ID: ${c.id} | Date: ${c.created_at} | Customer: ${c.customer_id} | Summary: ${c.summary}`);
  });
}

debugFilters();
