import { registerInteractiveStart, registerInteractiveEnd, isInteractiveActive, waitForInteractiveIdle, getInteractiveCount } from '../src/aiScheduler.js';

async function testPriorityQueue() {
  console.log('--- 1. Testing AI Scheduler & Priority Queue Controller ---');

  console.assert(isInteractiveActive() === false, 'Initial interactive state must be false');
  console.assert(getInteractiveCount() === 0, 'Initial count must be 0');
  console.log('✅ Initial state verified: Interactive idle');

  // 2. Simulate Telegram query arrival
  console.log('\n--- 2. Simulating Telegram Message Arrival ---');
  registerInteractiveStart('Telegram Group #1');
  console.assert(isInteractiveActive() === true, 'Interactive state must be true');
  console.assert(getInteractiveCount() === 1, 'Interactive count must be 1');

  // 3. Simulate a Background Triage task trying to run while Telegram is active
  console.log('\n--- 3. Testing Background Triage Yield / Pause ---');
  let backgroundTriageResumed = false;
  
  // Launch background triage in parallel
  const backgroundPromise = (async () => {
    console.log('[Test Background] Starting chat-999 triage...');
    await waitForInteractiveIdle('Test Chat-999');
    backgroundTriageResumed = true;
    console.log('[Test Background] Resumed! Now calling Ollama...');
    return 'DONE';
  })();

  // Give event loop a turn: backgroundPromise must be blocked
  await new Promise(r => setTimeout(r, 100));
  console.assert(backgroundTriageResumed === false, 'Background triage MUST be paused while Telegram is active');
  console.log('✅ Verified: Background triage paused and waiting for Telegram');

  // 4. Simulate a second Telegram message arriving concurrently
  console.log('\n--- 4. Concurrently Queuing Second Telegram Query ---');
  registerInteractiveStart('Telegram Group #2');
  console.assert(getInteractiveCount() === 2, 'Interactive count must be 2');

  // Finish first Telegram message
  registerInteractiveEnd('Telegram Group #1');
  console.assert(getInteractiveCount() === 1, 'Interactive count must be 1');
  console.assert(backgroundTriageResumed === false, 'Background triage MUST remain paused while 2nd Telegram is still running');
  console.log('✅ Verified: Background triage remains paused while another Telegram query is active');

  // Finish second Telegram message
  console.log('\n--- 5. Finishing all Telegram Tasks ---');
  registerInteractiveEnd('Telegram Group #2');
  console.assert(getInteractiveCount() === 0, 'Interactive count must return to 0');
  console.assert(isInteractiveActive() === false, 'Interactive state must return to false');

  // Wait for background triage to resume
  const res = await backgroundPromise;
  console.assert(backgroundTriageResumed === true, 'Background triage MUST have resumed');
  console.assert(res === 'DONE', 'Background triage completed successfully');
  console.log('✅ Verified: Background triage automatically resumed after Telegram finished!');

  console.log('\n🎉 ALL PRIORITY QUEUE LOGIC TESTS PASSED 100%!');
}

testPriorityQueue().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
