import dotenv from 'dotenv';
import { supabase } from '../src/supabase.js';

dotenv.config();

async function testPageFiltering() {
  const { data: chats } = await supabase
    .from('chats')
    .select('*, chat_issues(*)')
    .eq('company_id', '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2');

  console.log('Total chats from Supabase:', chats.length);

  const missingIds = ['chat-110802', 'chat-100127', 'chat-100122', 'chat-110803', 'chat-100131'];
  
  // Sort descending
  let result = [...chats].sort((a, b) => 
    new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );

  console.log('\n--- BEFORE FILTERS ---');
  missingIds.forEach(id => {
    const c = result.find(x => x.id === id);
    console.log(`${id}: found=${!!c}, status=${c?.status}, category_id=${c?.category_id}, priority=${c?.priority}, created_at=${c?.created_at}`);
  });

  // Filter 1: statusFilter (default 'all')
  // Filter 2: priorityFilter (default 'all')
  // Filter 3: categoryFilter (default 'all')
  // Filter 4: dateFilter (default 'all' or '7days')
  
  // Let's test dateFilter = '7days' with fixed reference time
  const now = new Date('2026-08-12T17:40:00+07:00');
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - 7);

  console.log('\n--- TESTING DATE FILTER 7 DAYS (cutoff:', cutoff.toISOString(), ') ---');
  const dateFiltered = result.filter(c => c.created_at && new Date(c.created_at) >= cutoff);
  console.log('Total in 7 days:', dateFiltered.length);
  
  missingIds.forEach(id => {
    const c = dateFiltered.find(x => x.id === id);
    console.log(`${id} in 7 days: ${!!c}`);
  });

  // Print all 14 rows visible in Screenshot 2 vs dateFiltered
  console.log('\n--- PRINTING ALL ITEMS IN DATE FILTERED LIST ---');
  dateFiltered.forEach((c, idx) => {
    console.log(`${idx + 1}. ID: ${c.id} | Date: ${new Date(c.created_at).toLocaleString('th-TH')} | Customer: ${c.customer_id} | Category: ${c.category_id} | Priority: ${c.priority}`);
  });
}

testPageFiltering();
