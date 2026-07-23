import { supabase } from './supabase.js';
import fetch from 'node-fetch';
import { payloads } from './test50Payloads.js';

async function run() {
  console.log('================================================================');
  console.log('🧪 Scheduled Multi-Round AI Triage Testing Suite');
  console.log('================================================================');
  console.log('- Total Rounds: 10');
  console.log('- Chats per Round: 3 (Spaced 1 minute apart)');
  console.log('- Expected chats: 30 complex chats with 4-6 sub-issues');

  // 1. Fetch credentials
  const { data: company, error: credError } = await supabase
    .from('companies')
    .select('client_id, client_secret')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (credError || !company) {
    console.error('❌ Failed to fetch credentials:', credError ? credError.message : 'No company found');
    return;
  }
  console.log(`✅ Loaded Client ID: ${company.client_id}`);

  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const runPrefix = `round-${day}${hours}${minutes}`;

  // 2. Select 30 complex chats from the payloads list
  // The first 5 in payloads are simple, so we start from index 5 (test-chat-006)
  const complexSource = payloads.slice(5, 35);
  const roundPayloads = complexSource.map((p, index) => {
    const roundIndex = String(index + 1).padStart(3, '0');
    return {
      id: `${runPrefix}-${roundIndex}`,
      customer_id: p.customer_id || 'cust-003',
      conversation: p.conversation,
      expected: p.expected
    };
  });

  // 3. Process 10 rounds
  for (let r = 1; r <= 10; r++) {
    const startIdx = (r - 1) * 3;
    const roundChats = roundPayloads.slice(startIdx, startIdx + 3);

    console.log(`\n================================================================`);
    console.log(`📦 ROUND ${r}/10 | Starting Ingestion`);
    console.log(`================================================================`);

    // Ingest 3 chats, 1 minute apart
    for (let c = 0; c < roundChats.length; c++) {
      const chat = roundChats[c];
      const timeStr = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      console.log(`[${timeStr}] Ingesting ${chat.id} (Item ${c + 1}/3 of Round ${r})`);
      
      try {
        const res = await fetch('http://localhost:4000/api/chats/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-client-id': company.client_id,
            'x-client-secret': company.client_secret
          },
          body: JSON.stringify({
            id: chat.id,
            customer_id: chat.customer_id,
            conversation: chat.conversation
          })
        });

        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || res.statusText);
        }
        console.log(`  ✅ ${chat.id} ingested successfully!`);
      } catch (err) {
        console.error(`  ❌ Failed to ingest ${chat.id}:`, err.message);
      }

      // Space ingestion by 1 minute (60 seconds)
      if (c < roundChats.length - 1) {
        console.log('  💤 Waiting 60 seconds before next ingestion...');
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
    }

    // Wait until all 3 chats are completed
    console.log(`\n  - Waiting for Round ${r} chats to complete triage sequentially...`);
    const pollStartTime = Date.now();
    const roundChatIds = roundChats.map(c => c.id);
    let completedCount = 0;

    while (completedCount < roundChatIds.length) {
      await new Promise(resolve => setTimeout(resolve, 15000));

      const { data: dbChats, error: pollError } = await supabase
        .from('chats')
        .select('id, status, category_id, summary')
        .in('id', roundChatIds);

      if (pollError) {
        console.error('    ❌ Error polling database:', pollError.message);
        continue;
      }

      const finished = dbChats.filter(c => c.status === 'completed' || c.status === 'failed');
      completedCount = finished.length;
      
      const elapsed = ((Date.now() - pollStartTime) / 1000).toFixed(0);
      console.log(`    [⏱️  Polling - ${elapsed}s elapsed] ${completedCount}/3 finished.`);

      if (completedCount < roundChatIds.length) {
        const pending = dbChats.filter(c => c.status !== 'completed' && c.status !== 'failed').map(c => c.id);
        console.log(`      Still processing: ${pending.join(', ')}`);
      } else {
        console.log(`\n  🎉 All 3 chats in Round ${r} have finished processing!`);
        dbChats.forEach(c => {
          console.log(`    - Chat: ${c.id} (Status: ${c.status})`);
          console.log(`      └─ AI Category: ${c.category_id || 'N/A'}`);
          console.log(`      └─ AI Summary:  "${c.summary || 'N/A'}"`);
        });
      }
    }

    // Space rounds by 2 minutes (120 seconds)
    if (r < 10) {
      console.log('\n💤 Waiting 2 minutes before starting the next round...');
      await new Promise(resolve => setTimeout(resolve, 120000));
    }
  }

  console.log('\n================================================================');
  console.log('🎉 Scheduled Multi-Round Testing Suite Complete!');
  console.log('================================================================\n');
}

run();
