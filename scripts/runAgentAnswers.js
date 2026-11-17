/**
 * scripts/runAgentAnswers.js
 * 
 * รันชุดคำถามจริง 62 ข้อจาก data/agent_eval_cases.json ผ่าน runExecAgent ทีละข้อ
 * แล้วบันทึกคำตอบเต็ม, tool ที่ใช้ และเวลาที่ใช้ลงไฟล์ data/agent_answers_YYYY-MM-DD.json
 * 
 * วิธีใช้งาน:
 *   node scripts/runAgentAnswers.js                  (รันทั้งหมด 62 ข้อ)
 *   node scripts/runAgentAnswers.js --limit 5        (รันแค่ 5 ข้อแรกเพื่อทดสอบ)
 *   node scripts/runAgentAnswers.js --start 10       (เริ่มจากข้อที่ 10 เป็นต้นไป)
 *   node scripts/runAgentAnswers.js --jaika-only     (ใช้ AI Jaika อย่างเดียว ไม่ fallback ไป Cloudflare/Ollama;
 *                                                     ถ้า Jaika ล่มจะรอแล้วถามข้อเดิมซ้ำ หยุดเองเมื่อ Jaika ปิด 18:00)
 *   node scripts/runAgentAnswers.js --resume         (ข้ามข้อที่มีคำตอบในไฟล์ผลลัพธ์แล้ว)
 */

import fs from 'fs';
import path from 'path';

// CLI args parsing (before the bot modules load, so --jaika-only can configure them)
const args = process.argv.slice(2);
const modelIdx = args.indexOf('--model');
// --model jaika|cloudflare|ollama pins one model so runs can be compared; --jaika-only = --model jaika
const pinnedModel = args.includes('--jaika-only') ? 'jaika' : (modelIdx !== -1 ? args[modelIdx + 1] : null);
if (pinnedModel && !['jaika', 'cloudflare', 'ollama'].includes(pinnedModel)) {
  console.error(`Unknown --model "${pinnedModel}" (use jaika, cloudflare or ollama)`);
  process.exit(1);
}
const jaikaOnly = pinnedModel === 'jaika';
const resume = args.includes('--resume');
const DEAD_URL = 'http://127.0.0.1:9'; // nothing listens here: blocks a backend

// dotenv never overrides variables already set, so these win over .env
if (jaikaOnly) {
  // No Cloudflare and no local Ollama.
  Object.assign(process.env, { JAIKA_ONLY: '1', OLLAMA_URL: DEAD_URL, CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_API_TOKEN: '' });
  // Share the Jaika key politely with the live bot (platform limit: 60 req/min, 4 concurrent)
  for (const [k, v] of Object.entries({ JAIKA_MAX_RPM: '20', JAIKA_MAX_CONCURRENT: '2', JAIKA_MAX_TPM: '50000', JAIKA_QUEUE_WAIT_MS: '120000', JAIKA_ONLY_MAX_WAIT_MS: '60000' })) process.env[k] ??= v;
} else if (pinnedModel === 'cloudflare') {
  // Cloudflare Workers AI only: no Jaika, no local Ollama; allow slow answers instead of the bot's 10 s fallback
  Object.assign(process.env, { JAIKA_BASE_URL: '', OLLAMA_URL: DEAD_URL });
  process.env.CLOUDFLARE_AGENT_TIMEOUT_MS ??= '120000';
} else if (pinnedModel === 'ollama') {
  // Local Ollama only (qwen2.5:14b + bge-m3 on this machine)
  Object.assign(process.env, { JAIKA_BASE_URL: '', CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_API_TOKEN: '', MODEL_LLM: 'qwen2.5:14b', MODEL_AGENT: 'qwen2.5:14b', MODEL_EMBEDDING: 'bge-m3' });
}

const { default: dotenv } = await import('dotenv');
dotenv.config();
const { runExecAgent } = await import('../src/execAgent/index.js');
const { loadCategoryContext } = await import('../src/execAgent/tools.js');
const { isJaikaConfigured, isJaikaOpenNow } = await import('../src/jaika.js');
const { exportToExcelAndSheets } = await import('./exportAnswersToGoogleSheets.js');

const companyId = process.env.DEFAULT_COMPANY_ID || '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2';
const casesFile = path.resolve('data/agent_eval_cases.json');
const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));

// Today's date in Thailand for the file name: YYYY-MM-DD
const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const defaultOutFile = path.resolve(`data/agent_answers_${todayStr}${pinnedModel ? `_${pinnedModel}` : ''}.json`);

const limitIdx = args.indexOf('--limit');
const defaultTotal = cases.length; // ทั้งชุด (62 ข้อ); ใช้ --limit เพื่อรันบางส่วน
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : defaultTotal;

const startIdx = args.indexOf('--start');
const startCase = startIdx !== -1 ? Math.max(1, parseInt(args[startIdx + 1], 10)) : 1;

const endCase = Math.min(startCase + limit - 1, cases.length);

const outIdx = args.indexOf('--out');
const outFile = outIdx !== -1 ? path.resolve(args[outIdx + 1]) : defaultOutFile;

// Jaika was down for a question (its own retries gave up): ask the same question again later
const JAIKA_DOWN = /temporarily unavailable|model_unavailable|Connection error|local rate limit|timed? ?out|Bad gateway|origin_bad_gateway|Tunnel error|\b50[234]\b|\b530\b/i;
const caseLogs = [];
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...a) => {
    caseLogs.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    orig(...a);
  };
}

async function main() {
  console.log(`\n============================================================`);
  console.log(`🚀 SIFT AI Executive Bot — Run Agent Answers`);
  console.log(`============================================================`);
  console.log(`📁 Source cases: ${casesFile} (Total: ${cases.length} cases)`);
  console.log(`💾 Output file:  ${outFile}`);
  console.log(`🏢 Company ID:   ${companyId}`);
  console.log(`🔢 Running cases: ${startCase} to ${endCase} (Target: ${defaultTotal} cases)`);
  console.log(`🧠 Model:        ${pinnedModel ? `${pinnedModel} only (no fallback)` : 'normal bot routing (Jaika in its hours, then fallbacks)'}`);
  console.log(`============================================================\n`);

  if (jaikaOnly) {
    if (!isJaikaConfigured()) throw new Error('AI Jaika is not configured (JAIKA_BASE_URL / JAIKA_API_KEY)');
    if (!isJaikaOpenNow()) throw new Error('AI Jaika is closed now (open 15:00-18:00 Bangkok time); run again in its hours');
  }

  // Pre-load category context to ensure DB cache is warm
  try {
    await loadCategoryContext(companyId);
  } catch (err) {
    console.warn(`⚠️ Warning pre-loading categories:`, err.message);
  }

  // Load existing answers if resuming or starting partial
  let results = [];
  if (fs.existsSync(outFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (Array.isArray(existing)) {
        results = existing;
        console.log(`ℹ️ Found ${results.length} existing results in ${path.basename(outFile)}`);
      }
    } catch (_) {}
  }

  const selectedCases = cases.slice(startCase - 1, endCase);

  for (let idx = 0; idx < selectedCases.length; idx++) {
    const caseIndex = startCase - 1 + idx;
    const c = selectedCases[idx];
    const caseNum = caseIndex + 1;

    if (resume && results.some(r => r.id === caseNum && r.auditStatus !== 'ERROR')) {
      console.log(`[${caseNum}/${defaultTotal}] ⏭️ already answered, skipped`);
      continue;
    }
    console.log(`[${caseNum}/${defaultTotal}] Q: "${c.q}"`);

    let output;
    let startTime;
    let usedJaika = false;
    let modelsUsed = [];
    for (;;) {
      if (jaikaOnly && !isJaikaOpenNow()) {
        console.log(`\n⏹️ AI Jaika closed (18:00). Stopped before case #${caseNum}; run again with --resume tomorrow.`);
        return finish(idx);
      }
      const evalChatId = `eval-${caseNum}-${Date.now()}`;
      startTime = Date.now();
      caseLogs.length = 0;
      try {
        // Pass explicitHistory if present in case; if not, pass empty array to prevent state leakage
        output = await runExecAgent({
          query: c.q,
          companyId,
          chatId: evalChatId,
          history: c.history || []
        });
      } catch (err) {
        console.error(`❌ Error in Case #${caseNum}:`, err.message);
        output = {
          reply: `❌ System Error: ${err.message}`,
          toolUsed: 'error',
          auditStatus: 'ERROR',
          slots: { error: err.message }
        };
      }
      usedJaika = caseLogs.some(l => l.includes('🟢 [AI Jaika]'));
      modelsUsed = [['jaika', '🟢 [AI Jaika]'], ['cloudflare', '🟠 [Cloudflare AI]'], ['ollama', '🔵 [Ollama]']]
        .filter(([, mark]) => caseLogs.some(l => l.includes(mark))).map(([name]) => name);
      const jaikaDown = jaikaOnly && caseLogs.some(l => JAIKA_DOWN.test(l) && !l.includes('[AI Jaika only]'));
      if (!jaikaDown) break;
      console.log(`   ⏸️ AI Jaika unavailable for this question; waiting 60 s and asking again...`);
      await new Promise(r => setTimeout(r, 60000));
    }

    const durationMs = Date.now() - startTime;
    const durationSec = (durationMs / 1000).toFixed(2);

    console.log(`   ➔ Tool: ${output.toolUsed || '-'} | Status: ${output.auditStatus || '-'} | ⏱️ ${durationSec}s`);
    const preview = (output.reply || '').split('\n').filter(Boolean).slice(0, 2).join(' / ');
    console.log(`   ➔ Reply: ${preview.substring(0, 100)}...\n`);

    const resultRecord = {
      id: caseNum,
      q: c.q,
      expect: c.expect || {},
      ...(c.history ? { history: c.history } : {}),
      toolUsed: output.toolUsed,
      auditStatus: output.auditStatus,
      // Which model(s) actually answered; empty = no LLM call (e.g. a blocked personal-data question)
      model: modelsUsed.join('+') || 'none',
      durationMs,
      reply: output.reply,
      slots: output.slots || null
    };

    // Update in-place if ID already exists, otherwise push
    const existingIdx = results.findIndex(r => r.id === caseNum);
    if (existingIdx !== -1) {
      results[existingIdx] = resultRecord;
    } else {
      results.push(resultRecord);
    }

    // Sort results by ID
    results.sort((a, b) => a.id - b.id);

    // Save incrementally so progress is never lost
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8');
  }

  return finish(selectedCases.length);

  async function finish(processed) {
    console.log(`\n============================================================`);
    console.log(`✅ Completed! Processed ${processed} of ${selectedCases.length} cases.`);
    console.log(`💾 All answers saved to: ${outFile}`);
    console.log(`============================================================\n`);

    try {
      await exportToExcelAndSheets(outFile);
    } catch (expErr) {
      console.warn(`⚠️ Error generating Google Sheets export:`, expErr.message);
    }
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal execution error:', err.message);
  process.exit(1);
});
