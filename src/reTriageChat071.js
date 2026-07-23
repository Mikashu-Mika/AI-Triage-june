import { supabase } from './supabase.js';
import { processSingleChat } from './triageService.js';

async function run() {
  console.log('=== Re-Evaluating chat-071 with Few-Shot Training ===');
  
  // Step 1: Reset chat-071 to pending
  console.log('- Resetting chat-071 status to pending...');
  const { error: resetErr } = await supabase
    .from('chats')
    .update({
      status: 'pending',
      category_id: null,
      priority: null,
      summary: null,
      sub_category: null,
      intent: null,
      root_cause: null,
      sentiment: null,
      urgency: null,
      department: null,
      keywords: null,
      confidence: null,
      recommended_reply: null,
      resolution: 'Pending',
      business_impact: null,
      business_impact_score: null,
      ai_recommendation: null
    })
    .eq('id', 'chat-071');

  if (resetErr) {
    console.error('❌ Failed to reset chat:', resetErr.message);
    return;
  }
  console.log('✅ Reset completed successfully!');

  // Step 2: Trigger real-time triage
  console.log('- Re-processing chat-071...');
  try {
    await processSingleChat('chat-071');
    console.log('✅ Processing finished!');
    
    // Step 3: Fetch result for verification
    const { data: chat, error: fetchErr } = await supabase
      .from('chats')
      .select('id, category_id, priority, resolution, summary')
      .eq('id', 'chat-071')
      .single();
      
    if (fetchErr) throw fetchErr;
    
    console.log('\n=== Verification Report ===');
    console.log(`📁 Chat ID:     ${chat.id}`);
    console.log(`🏷️  Category:    ${chat.category_id}`);
    console.log(`⭐ Priority:    ${chat.priority}`);
    console.log(`🏁 Resolution:  ${chat.resolution}`);
    console.log(`📝 Summary:     "${chat.summary}"`);
    console.log('===========================\n');
  } catch (err) {
    console.error('❌ Processing failed:', err.message);
  }
}

run();
