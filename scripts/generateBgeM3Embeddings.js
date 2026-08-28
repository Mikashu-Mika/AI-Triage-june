import { supabase } from '../src/supabase.js';
import http from 'http';
import dotenv from 'dotenv';
dotenv.config();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL_EMBEDDING = process.env.MODEL_EMBEDDING || 'bge-m3';

/**
 * Generate Vector Embedding via Ollama bge-m3 model
 */
function getVectorEmbedding(text) {
  return new Promise((resolve, reject) => {
    const url = new URL(OLLAMA_URL + '/api/embeddings');
    const postData = JSON.stringify({
      model: MODEL_EMBEDDING,
      prompt: text
    });

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.embedding) {
            resolve(json.embedding);
          } else {
            reject(new Error(json.error || 'No embedding array in response'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

export async function computeAllEmbeddings() {
  console.log(`🚀 Pre-computing bge-m3 Vector Embeddings for 100 training_examples using ${MODEL_EMBEDDING}...\n`);

  // 1. Fetch training_examples
  const { data: examples, error } = await supabase
    .from('training_examples')
    .select('id, input_text, expected_output');

  if (error || !examples || examples.length === 0) {
    console.error('❌ Failed to fetch training_examples:', error?.message);
    return;
  }

  console.log(`📋 Found ${examples.length} training_examples rows in Supabase. Generating vectors...\n`);

  let successCount = 0;
  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];
    console.log(`[${i + 1}/${examples.length}] 🧠 Embedding: "${ex.input_text.substring(0, 50)}..."`);

    try {
      const vec = await getVectorEmbedding(ex.input_text);
      console.log(`   Vector dimensions: ${vec.length} (bge-m3)`);

      // Update row in Supabase with vector embedding
      const { error: updErr } = await supabase
        .from('training_examples')
        .update({ embedding: vec })
        .eq('id', ex.id);

      if (updErr) {
        console.warn(`   ⚠️ Supabase update notice for ${ex.id}: ${updErr.message}`);
      } else {
        successCount++;
        console.log(`   ✅ Saved vector embedding into Supabase!`);
      }
    } catch (err) {
      console.error(`   ❌ Failed to generate embedding: ${err.message}`);
    }
  }

  console.log(`\n🎉 Vector Embedding Pre-computation Complete! (${successCount}/${examples.length} records updated)`);
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  computeAllEmbeddings().then(() => process.exit(0));
}
