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
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { runExecAgent } from '../src/execAgent/index.js';
import { loadCategoryContext } from '../src/execAgent/tools.js';
import { exportToExcelAndSheets } from './exportAnswersToGoogleSheets.js';

dotenv.config();

const companyId = process.env.DEFAULT_COMPANY_ID || '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2';
const casesFile = path.resolve('data/agent_eval_cases.json');
const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));

// Format today's date for filename: YYYY-MM-DD (e.g. 2026-11-11)
const todayStr = new Date().toISOString().substring(0, 10);
const defaultOutFile = path.resolve(`data/agent_answers_${todayStr}.json`);

// CLI args parsing
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const defaultTotal = 30; // ปรับเหลือ 30 ข้อตามที่มิกะต้องการ
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : defaultTotal;

const startIdx = args.indexOf('--start');
const startCase = startIdx !== -1 ? Math.max(1, parseInt(args[startIdx + 1], 10)) : 1;

const endCase = Math.min(startCase + limit - 1, defaultTotal, cases.length);

const outIdx = args.indexOf('--out');
const outFile = outIdx !== -1 ? path.resolve(args[outIdx + 1]) : defaultOutFile;

async function main() {
  console.log(`\n============================================================`);
  console.log(`🚀 SIFT AI Executive Bot — Run Agent Answers`);
  console.log(`============================================================`);
  console.log(`📁 Source cases: ${casesFile} (Total: ${cases.length} cases)`);
  console.log(`💾 Output file:  ${outFile}`);
  console.log(`🏢 Company ID:   ${companyId}`);
  console.log(`🔢 Running cases: ${startCase} to ${endCase} (Target: ${defaultTotal} cases)`);
  console.log(`============================================================\n`);

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

    console.log(`[${caseNum}/${defaultTotal}] Q: "${c.q}"`);

    const evalChatId = `eval-${caseNum}-${Date.now()}`;
    const startTime = Date.now();

    let output;
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

  console.log(`\n============================================================`);
  console.log(`✅ Completed! Processed ${selectedCases.length} cases.`);
  console.log(`💾 All answers saved to: ${outFile}`);
  console.log(`============================================================\n`);

  try {
    await exportToExcelAndSheets(outFile);
  } catch (expErr) {
    console.warn(`⚠️ Error generating Google Sheets export:`, expErr.message);
  }
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
