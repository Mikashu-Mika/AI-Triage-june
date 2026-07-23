import dotenv from 'dotenv';
import { supabase } from './supabase.js';

dotenv.config();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL_LLM = process.env.MODEL_LLM || 'qwen2.5:14b';
const MODEL_EMBEDDING = process.env.MODEL_EMBEDDING || 'bge-m3';

async function testOllama() {
  console.log(`\n--- Testing Ollama Connection ---`);
  console.log(`Ollama URL: ${OLLAMA_URL}`);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) throw new Error(`Tags response: ${res.statusText}`);
    const data = await res.json();
    console.log(`✅ Connected to Ollama server successfully.`);
    const models = data.models || [];
    console.log(`Available local models:`, models.map(m => m.name));
    
    const hasLLM = models.some(m => m.name.includes(MODEL_LLM));
    const hasEmbed = models.some(m => m.name.includes(MODEL_EMBEDDING));

    console.log(`${hasLLM ? '✅' : '❌'} Model LLM "${MODEL_LLM}" is ${hasLLM ? 'available' : 'NOT downloaded'}`);
    console.log(`${hasEmbed ? '✅' : '❌'} Model Embedding "${MODEL_EMBEDDING}" is ${hasEmbed ? 'available' : 'NOT downloaded'}`);
  } catch (error) {
    console.error(`❌ Could not connect to Ollama server: ${error.message}`);
    console.log(`👉 Please ensure Ollama is running on your machine.`);
    return false;
  }

  try {
    console.log(`Testing chat generation with ${MODEL_LLM}...`);
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_LLM,
        messages: [{ role: 'user', content: 'ตอบสั้นๆ ว่า "สวัสดี"' }],
        stream: false
      })
    });
    const data = await res.json();
    console.log(`✅ ${MODEL_LLM} response: "${data.message?.content?.trim()}"`);
  } catch (error) {
    console.error(`❌ Chat generation failed: ${error.message}`);
  }

  try {
    console.log(`Testing embedding generation with ${MODEL_EMBEDDING}...`);
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_EMBEDDING,
        prompt: 'สวัสดีครับ'
      })
    });
    const data = await res.json();
    if (data.embedding) {
      console.log(`✅ Embedding generated successfully. Dimensions: ${data.embedding.length}`);
    } else {
      throw new Error(`Response did not contain embedding array.`);
    }
  } catch (error) {
    console.error(`❌ Embedding generation failed: ${error.message}`);
  }
}

async function testSupabase() {
  console.log(`\n--- Testing Supabase Connection ---`);
  console.log(`Supabase URL: ${process.env.SUPABASE_URL}`);
  
  if (!process.env.SUPABASE_URL || process.env.SUPABASE_URL.includes('YOUR_SUPABASE_') || !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY.includes('YOUR_SUPABASE_')) {
    console.log(`❌ Supabase environment variables are missing or placeholders.`);
    console.log(`👉 Please update the .env file with your project credentials.`);
    return;
  }

  try {
    const { data, count, error } = await supabase
      .from('chats')
      .select('id', { count: 'exact', head: true });

    if (error) {
      if (error.code === 'PGRST116' || error.message.includes('does not exist')) {
        console.log(`❌ Supabase connected, but the table "chats" does not exist.`);
        console.log(`👉 Please run the table creation SQL in your Supabase SQL Editor.`);
      } else {
        throw error;
      }
    } else {
      console.log(`✅ Connected to Supabase successfully.`);
      console.log(`Database count on "chats" table: ${count} chats found.`);
    }
  } catch (error) {
    console.error(`❌ Supabase query failed: ${error.message}`);
  }
}

async function run() {
  console.log('=== Running Diagnostics ===');
  await testOllama();
  await testSupabase();
}

run();
