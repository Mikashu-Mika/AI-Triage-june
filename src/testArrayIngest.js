import { supabase } from './supabase.js';

async function run() {
  console.log('=== Testing Ingestion with JSON Array Conversation ===');
  
  const chatId = 'chat-056-test';
  
  // Clean up previous test record if exists
  await supabase.from('chats').delete().eq('id', chatId);
  
  const payload = {
    id: chatId,
    customer_id: 'cust-003',
    conversation: [
      "ลูกค้า: ทำไมเข้าเว็บแล้วค้าง",
      "ลูกค้า: จอขาว",
      "ลูกค้า: เว็บกาก"
    ]
  };

  console.log(`- Sending POST request to Ingest API for ${chatId}...`);
  try {
    const response = await fetch('http://localhost:4000/api/chats/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    console.log('✅ Ingest API Response:', JSON.stringify(result, null, 2));

    // Wait 15 seconds for background triage
    console.log('- Waiting 15 seconds for background AI Triage...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Query database
    console.log('- Querying database to verify joined text and AI classification...');
    const { data: chat, error } = await supabase
      .from('chats')
      .select('*')
      .eq('id', chatId)
      .single();

    if (error || !chat) {
      throw new Error(`Failed to fetch chat: ${error?.message || 'Not found'}`);
    }

    console.log('\n================ Verification Report ================');
    console.log(`📁 Chat ID:     ${chat.id}`);
    console.log(`🏷️  Category:    ${chat.category_id}`);
    console.log(`⭐ Priority:    ${chat.priority}`);
    console.log(`📝 Joined Conversation:\n${chat.conversation}`);
    console.log('=====================================================\n');

  } catch (err) {
    console.error('❌ Test failed:', err.message);
  }
}

run();
