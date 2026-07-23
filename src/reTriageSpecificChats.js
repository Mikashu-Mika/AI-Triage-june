import dotenv from 'dotenv';
import { supabase } from './supabase.js';
import { processSingleChat } from './triageService.js';

dotenv.config();

async function run() {
  console.log('=== Re-Evaluating Specific Inquiries (chat-062, chat-063, chat-066) ===');
  const targetIds = ['chat-062', 'chat-063', 'chat-066'];

  try {
    // 1. Reset specific chats back to pending
    console.log('\nStep 1: Resetting chats in Supabase...');
    const { error: resetErr } = await supabase
      .from('chats')
      .update({
        status: 'pending',
        category_id: null,
        sub_category: null,
        intent: null,
        root_cause: null,
        sentiment: null,
        urgency: null,
        priority: null,
        department: null,
        summary: null,
        keywords: null,
        confidence: null,
        recommended_reply: null,
        resolution: 'Pending',
        business_impact: null,
        business_impact_score: null,
        ai_recommendation: null,
        embedding: null
      })
      .in('id', targetIds);

    if (resetErr) throw resetErr;
    console.log('✅ Reset completed successfully!');

    // 2. Process each chat through the pipeline
    console.log('\nStep 2: Running real-time triage for target chats...');
    for (const id of targetIds) {
      console.log(`- Re-processing ${id}...`);
      await processSingleChat(id);
    }
    console.log('✅ Processing finished!');

    // 3. Print results to verify
    console.log('\nStep 3: Verification Report');
    console.log('========================================================================');
    
    const { data: chats, error: fetchErr } = await supabase
      .from('chats')
      .select('id, conversation, category_id, priority, resolution, department')
      .in('id', targetIds);

    if (fetchErr) throw fetchErr;

    for (const chat of chats) {
      console.log(`📁 Chat ID:     ${chat.id}`);
      console.log(`💬 Conversation: "${chat.conversation.replace(/\n/g, ' | ')}"`);
      console.log(`🏷️  Category:    ${chat.category_id}`);
      console.log(`⭐ Priority:    ${chat.priority}`);
      console.log(`🏁 Resolution:  ${chat.resolution}`);
      console.log(`🏢 Department:  ${chat.department}`);
      console.log('------------------------------------------------------------------------');
    }
    console.log('=== Verification Finished ===\n');

  } catch (error) {
    console.error('❌ Failed:', error.message);
  }
}

run();
