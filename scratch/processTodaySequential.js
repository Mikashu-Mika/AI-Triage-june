import { processSingleChat } from '../src/triageService.js';
import { supabase } from '../src/supabase.js';

async function main() {
  const chatIds = ['chat-0115', 'chat-10100', 'chat-0116', 'chat-0117'];
  console.log('🚀 Starting sequential AI Triage for today\'s 4 chats...');

  // Reset status to pending for clean run
  await supabase
    .from('chats')
    .update({ status: 'pending', summary: null })
    .in('id', chatIds);

  for (let i = 0; i < chatIds.length; i++) {
    const chatId = chatIds[i];
    console.log(`\n--------------------------------------------------`);
    console.log(`[${i + 1}/${chatIds.length}] Processing Chat: ${chatId} ...`);
    const start = Date.now();
    
    try {
      await processSingleChat(chatId);
      const duration = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`✅ Chat ${chatId} finished successfully in ${duration}s!`);

      // Fetch and print result summary from Supabase
      const { data: chat } = await supabase
        .from('chats')
        .select('id, category_id, priority, summary, department, chat_issues(*)')
        .eq('id', chatId)
        .single();

      console.log(`   └─ Category: ${chat.category_id} | Priority: ${chat.priority} | Dept: ${chat.department}`);
      console.log(`   └─ Summary: ${chat.summary}`);
      console.log(`   └─ Sub-issues extracted: ${chat.chat_issues?.length || 0}`);
      chat.chat_issues?.forEach(iss => {
        console.log(`      • [${iss.category_id}] (${iss.department}): "${iss.summary}"`);
      });

    } catch (err) {
      console.error(`❌ Chat ${chatId} failed:`, err.message);
    }

    // Small pause between chats for Ollama stability
    if (i < chatIds.length - 1) {
      console.log(`⏳ Waiting 3 seconds before processing next chat...`);
      await new Promise(res => setTimeout(res, 3000));
    }
  }

  console.log(`\n🎉 All 4 chats processed successfully!`);
}

main();
