import { supabase } from './src/supabase.js';

async function main() {
  const { data: chats } = await supabase
    .from('chats')
    .select('id, status, category_id, priority, summary')
    .ilike('id', 'chat-customer-%')
    .order('id', { ascending: true });

  chats.forEach((c, i) => {
    console.log(${i+1}. [] หมวด:  | ระดับ:  | สถานะ: \n   สรุป: \n);
  });
  process.exit(0);
}
main();
