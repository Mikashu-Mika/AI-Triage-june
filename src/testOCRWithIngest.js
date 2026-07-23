import fs from 'fs';
import path from 'path';
import { supabase } from './supabase.js';

async function run() {
  console.log('=== Testing Real-time Ingestion with Base64 Image ===');
  
  // 1. Read local test image and convert to Base64 data URL
  const imagePath = 'C:/Users/USER/.gemini/antigravity/brain/72acfc1c-d267-4592-bf90-b146dd7cd9b2/media__1783582776397.png';
  console.log(`- Loading test image: ${imagePath}`);
  
  let base64Image = '';
  try {
    const fileBuffer = fs.readFileSync(imagePath);
    const base64Data = fileBuffer.toString('base64');
    base64Image = `data:image/png;base64,${base64Data}`;
    console.log('✅ Image loaded and converted to Base64 successfully!');
  } catch (err) {
    console.error('❌ Failed to read test image:', err.message);
    return;
  }

  const chatId = `chat-ocr-test-${Date.now().toString().slice(-4)}`;
  const payload = {
    id: chatId,
    customer_id: 'cust-003',
    conversation: 'ลูกค้า: หน้าจอมันค้างแสดงผลอะไรไม่รู้ค่ะ แอดมินรบกวนช่วยเช็กสลิปในรูปนี้ให้หน่อยค่ะว่าเข้าระบบหรือยัง',
    image: base64Image
  };

  // 2. Post to ingest API
  console.log(`- Sending POST request to Ingest API for ${chatId}...`);
  try {
    const response = await fetch('http://localhost:4000/api/chats/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    console.log('✅ Ingest API Response:', JSON.stringify(result, null, 2));

    // 3. Wait for background AI Triage process to finish
    console.log('- Waiting 15 seconds for AI Triage pipeline to run...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // 4. Query the database to check if the OCR text was appended and analyzed!
    console.log('- Querying database for triage results...');
    const { data: chat, error } = await supabase
      .from('chats')
      .select('*')
      .eq('id', chatId)
      .single();

    if (error || !chat) {
      throw new Error(`Failed to fetch chat result: ${error?.message || 'Chat not found'}`);
    }

    console.log('\n================ End-to-End Test Result ================');
    console.log(`📁 Chat ID:     ${chat.id}`);
    console.log(`🏷️  Category:    ${chat.category_id}`);
    console.log(`⭐ Priority:    ${chat.priority}`);
    console.log(`🏁 Resolution:  ${chat.resolution}`);
    console.log(`📝 Full Conversation (with OCR appended):\n${chat.conversation}`);
    console.log('\n🤖 AI Summary:\n' + chat.summary);
    console.log('========================================================\n');

  } catch (err) {
    console.error('❌ End-to-End Image Ingest Test failed:', err.message);
  }
}

run();
