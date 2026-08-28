import dotenv from 'dotenv';
import { supabase } from '../src/supabase.js';

dotenv.config();

async function requeueNullChats() {
  console.log('Finding chats with null category_id...');
  
  // Find chats where category_id is null
  const { data, error } = await supabase
    .from('chats')
    .select('id, summary, created_at')
    .is('category_id', null)
    .eq('company_id', '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2');

  if (error) {
    console.error('Error fetching chats:', error.message);
    return;
  }

  console.log(`Found ${data.length} chats with null category_id.`);
  console.log('Sample IDs:', data.slice(0, 5).map(c => c.id));
}

requeueNullChats();
