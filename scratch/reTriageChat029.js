import { processSingleChat } from '../src/triageService.js';
import { supabase } from '../src/supabase.js';

async function main() {
  console.log('🔄 Re-running AI Triage Analysis for Chat: round-dense-241014-029 ...');
  
  try {
    await processSingleChat('round-dense-241014-029');
    console.log('✅ Re-triage analysis finished successfully!');

    // Query updated results from Supabase
    const { data: chat } = await supabase
      .from('chats')
      .select('*, chat_issues(*)')
      .eq('id', 'round-dense-241014-029')
      .single();

    console.log('\n📊 Updated Triage Results:');
    console.log(`- Chat ID: ${chat.id}`);
    console.log(`- Primary Category: ${chat.category_id}`);
    console.log(`- Summary: ${chat.summary}`);
    console.log('\n📌 Multi-Issue Breakdown:');
    chat.chat_issues.forEach(issue => {
      console.log(`- Summary: "${issue.summary}"`);
      console.log(`  └─ Category ID: ${issue.category_id}`);
      console.log(`  └─ Priority: ${issue.priority} | Department: ${issue.department}`);
    });
  } catch (err) {
    console.error('❌ Re-triage error:', err);
  }
}

main();
