import dotenv from 'dotenv';
import { supabase } from './supabase.js';

dotenv.config();

async function reset() {
  console.log('Resetting all chats in Supabase back to pending...');
  
  // Supabase updates require a filter, we use neq('id', 'none') to match all rows
  const { data, error } = await supabase
    .from('chats')
    .update({
      status: 'pending',
      category_id: null,
      priority: null,
      summary: null,
      embedding: null
    })
    .neq('id', 'none-existing-id')
    .select();

  if (error) {
    console.error('❌ Failed to reset chats:', error.message);
  } else {
    console.log(`✅ Chats reset to pending successfully! Resetted ${data?.length || 0} rows.`);
  }
}

reset();
