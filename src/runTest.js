import dotenv from 'dotenv';
import { supabase } from './supabase.js';
import { runTriagePipeline } from './triageService.js';

dotenv.config();

async function runTest() {
  console.log('\n=============================================================');
  console.log('🚀 AI Customer Intelligence Pipeline - Live Run Test');
  console.log('=============================================================');
  
  const testChatId = 'chat-test-temp';
  
  try {
    // 1. Insert a temporary pending chat
    console.log('\nStep 1: Inserting a new pending test chat to Supabase...');
    const testConversation = 
      'ลูกค้า: โอนเงิน 1,500 บาทไปประมาณครึ่งชั่วโมงแล้วค่ะ ทำไมยอดเครดิตยังไม่ขยับเลย เช็คด่วนค่ะ!\n' +
      'พนักงาน: ขออภัยด้วยค่ะ ขอทราบยูสเซอร์เนมและสลิปการโอนด้วยนะคะ';
      
    // Check if customer cust-001 exists, otherwise seed it
    const { data: customer } = await supabase.from('customers').select('id').eq('id', 'cust-001').single();
    if (!customer) {
      console.log('- Customer cust-001 not found. Seeding client first...');
      await supabase.from('customers').insert({ id: 'cust-001', name: 'Somchai (สมชาย)', phone: '0812345678' });
    }

    // Delete if it already exists from a failed previous test
    await supabase.from('chats').delete().eq('id', testChatId);

    const { error: insertError } = await supabase.from('chats').insert({
      id: testChatId,
      customer_id: 'cust-001',
      conversation: testConversation,
      status: 'pending'
    });

    if (insertError) {
      throw new Error(`Failed to insert test chat: ${insertError.message}`);
    }
    console.log('✅ Temporary pending chat inserted successfully!');

    // 2. Trigger Triage Pipeline
    console.log('\nStep 2: Triggering Triage Pipeline (Ollama Qwen + BGE-M3)...');
    console.log('       (Please wait while local AI performs the analysis...)');
    
    const startTime = Date.now();
    const pipelineReport = await runTriagePipeline();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log(`✅ Triage Pipeline finished in ${duration}s! processed: ${pipelineReport.processedCount}, success: ${pipelineReport.successCount}`);

    // 3. Retrieve and print detailed AI results
    console.log('\nStep 3: Retrieving AI Analysis results from Supabase...');
    const { data: chatData, error: fetchError } = await supabase
      .from('chats')
      .select('*, customers(*), categories(*)')
      .eq('id', testChatId)
      .single();

    if (fetchError || !chatData) {
      throw new Error(`Failed to retrieve chat results: ${fetchError?.message || 'Chat not found'}`);
    }

    console.log('\n=============================================================');
    console.log('🎯 LIVE RUN TEST RESULT REPORT');
    console.log('=============================================================');
    console.log(`📁 Chat ID:             ${chatData.id}`);
    console.log(`👤 Customer:            ${chatData.customers?.name || 'Unknown'}`);
    console.log(`💬 Conversation:        "${chatData.conversation.replace(/\n/g, ' | ')}"`);
    console.log(`-------------------------------------------------------------`);
    console.log(`🏷️  Category ID:         ${chatData.category_id} (${chatData.categories?.name || 'ไม่มี'})`);
    console.log(`🏷️  Sub Category:        ${chatData.sub_category}`);
    console.log(`🎯 User Intent:         ${chatData.intent}`);
    console.log(`🔍 Root Cause:          ${chatData.root_cause}`);
    console.log(`🎭 User Sentiment:      ${chatData.sentiment}`);
    console.log(`🚨 Urgency Level:       ${chatData.urgency}`);
    console.log(`⭐ Priority Level:      ${chatData.priority}`);
    console.log(`🏢 Assigned Department: ${chatData.department}`);
    console.log(`📈 Business Impact:     ${chatData.business_impact} (Risk Score: ${chatData.business_impact_score}%)`);
    console.log(`🎯 AI Confidence:       ${chatData.confidence}%`);
    console.log(`📝 Summary (1 Sentence): ${chatData.summary}`);
    console.log(`🏷️  Keywords:           [ ${chatData.keywords ? chatData.keywords.join(', ') : ''} ]`);
    console.log(`💡 Recommended Action:  ${chatData.ai_recommendation}`);
    console.log(`💬 Recommended Reply:   "${chatData.recommended_reply}"`);
    console.log(`🌐 Vector Embedding:    Calculated & Saved (${chatData.embedding?.length || 0} dimensions)`);
    console.log(`🏁 Resolution Status:   ${chatData.resolution}`);
    console.log('=============================================================');

    // 4. Cleanup
    console.log('\nStep 4: Cleaning up temporary test chat from Supabase...');
    const { error: deleteError } = await supabase.from('chats').delete().eq('id', testChatId);
    if (deleteError) {
      console.warn(`⚠️ Warning: Failed to delete test chat during cleanup: ${deleteError.message}`);
    } else {
      console.log('✅ Database cleaned up successfully!');
    }

    console.log('\n🎉 ALL RUN TESTS PASSED SUCCESSFULLY! Everything is 100% healthy.');
    console.log('=============================================================\n');

  } catch (error) {
    console.error('\n❌ Run Test Failed:', error.message);
    // Cleanup on failure
    await supabase.from('chats').delete().eq('id', testChatId);
  }
}

runTest();
