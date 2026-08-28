import { supabase } from './supabase.js';
import { processSingleChat } from './triageService.js';

async function test10152() {
  console.log('Re-processing chat-10152 with Kru Sam Logic...');
  await processSingleChat('chat-10152');
  
  const { data: issues } = await supabase
    .from('chat_issues')
    .select('*')
    .eq('chat_id', 'chat-10152');
    
  console.log('\n=== CHAT-10152 UPDATED CHAT_ISSUES IN SUPABASE ===');
  console.log(JSON.stringify(issues, null, 2));
}

test10152().catch(console.error);
