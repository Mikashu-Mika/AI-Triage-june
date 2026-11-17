// Side-by-side comparison of the 62 eval questions across models, ready to import into Google Sheets.
// Usage: node scripts/compareModels.cjs <date YYYY-MM-DD> <out.xlsx>
// Reads data/agent_answers_<date>_{cloudflare,ollama,jaika}.json (missing files show as "ยังไม่ได้รัน")
// and data/agent_answers_2026-11-11.json (the earlier 30-question run) as the old baseline.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const [, , date, outFile] = process.argv;
const cases = JSON.parse(fs.readFileSync('data/agent_eval_cases.json', 'utf8'));
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const RUNS = [
  { key: 'old', label: 'รอบเดิม 11 พ.ย. (โค้ดเก่า)', file: 'data/agent_answers_2026-11-11.json', model: 'Ollama qwen2.5:14b', log: null },
  { key: 'cloudflare', label: 'Cloudflare', file: `data/agent_answers_${date}_cloudflare.json`, log: `data/run_62_cloudflare.log`, model: '@cf/qwen/qwen2.5-coder-32b-instruct' },
  { key: 'ollama', label: 'Ollama ในเครื่อง', file: `data/agent_answers_${date}_ollama.json`, log: `data/run_62_ollama.log`, model: 'qwen2.5:14b (CPU)' },
  { key: 'jaika', label: 'AI Jaika', file: `data/agent_answers_${date}_jaika.json`, log: `data/run_62_jaika.log`, model: 'qwen2.5-14b' },
  { key: 'jaika_fix', label: 'AI Jaika หลังแก้ (งาน 1.2)', file: `data/agent_answers_${date}_jaika_fix.json`, log: `data/run_62_jaika_fix.log`, model: 'qwen2.5-14b' },
].map(r => ({ ...r, data: load(r.file), log: r.log && fs.existsSync(r.log) ? parseLog(r.log) : null }));

/** Split a run log by question ("[n/62] Q: ...") and pick out model calls, errors and the answer checker's warnings */
function parseLog(file) {
  const events = []; let q = 0;
  const count = { jaika: 0, cloudflare: 0, ollama: 0, retries: 0, apiErrors: 0, sysErrors: 0, guard: 0 };
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\[(\d+)\/\d+\] Q:/); if (m) { q = +m[1]; continue; }
    if (line.includes('🟢 [AI Jaika]')) count.jaika++;
    if (line.includes('🟠 [Cloudflare AI]')) count.cloudflare++;
    if (line.includes('🔵 [Ollama]')) count.ollama++;
    let kind = null;
    if (/⏸️|\[AI Jaika only\].*retrying/.test(line)) { count.retries++; kind = 'รอแล้วลองซ้ำ'; }
    else if (/\[AI Jaika\] Error|\[Cloudflare AI\] (HTTP|Exception)|Ollama HTTP|Ollama request timeout/.test(line)) { count.apiErrors++; kind = 'AI ตอบไม่ได้ (API error)'; }
    else if (/^❌/.test(line.trim())) { count.sysErrors++; kind = 'ระบบ error'; }
    else if (/using deterministic format/.test(line)) { count.guard++; kind = 'ตัวตรวจไม่ใช้ข้อความ AI → ใช้รูปแบบตายตัว'; }
    else if (/⚠️ \[Composer\]/.test(line)) kind = 'เหตุผลของตัวตรวจ';
    if (kind) events.push({ q, kind, text: line.trim().slice(0, 300) });
  }
  return { count, events };
}

const asList = v => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Compare the bot's plan with the expected plan of the eval case; returns the mismatches (empty = plan correct) */
function checkPlan(expect, ans) {
  const miss = [];
  const calls = ans.slots?.calls || [];
  const tools = (ans.toolUsed || '').split('+');
  const first = calls[0]?.args || {};
  if (expect.tool && !asList(expect.tool).some(t => tools.includes(t))) miss.push(`tool ${ans.toolUsed || '-'} (ควรเป็น ${asList(expect.tool).join('/')})`);
  if (expect.period && !calls.some(c => c.args?.period?.type === expect.period)) miss.push(`ช่วงเวลา ${first.period?.type || '-'} (ควรเป็น ${expect.period})`);
  if (expect.categories && !calls.some(c => expect.categories.every(k => (c.args?.categories || []).includes(k)))) miss.push(`หมวด ${(first.categories || []).join(',') || '-'} (ควรเป็น ${expect.categories.join(',')})`);
  if (expect.category && !calls.some(c => c.args?.category === expect.category)) miss.push(`หมวด ${first.category || '-'} (ควรเป็น ${expect.category})`);
  if (expect.group_by && !calls.some(c => c.args?.group_by === expect.group_by)) miss.push(`จัดกลุ่ม ${first.group_by || '-'} (ควรเป็น ${expect.group_by})`);
  if (expect.metric && !calls.some(c => c.args?.metric === expect.metric)) miss.push(`metric ${first.metric || '-'} (ควรเป็น ${expect.metric})`);
  if (expect.unsupported) {
    const got = ans.slots?.unsupported_topics || [];
    if (!expect.unsupported.every(u => got.includes(u))) miss.push(`ไม่ได้บอกว่าไม่มีข้อมูล ${expect.unsupported.join(',')}`);
  }
  if (expect.mode === 'chitchat' && ans.toolUsed !== 'chitchat') miss.push(`ควรตอบแบบคุยเล่น (ได้ ${ans.toolUsed})`);
  if (ans.auditStatus === 'ERROR') miss.unshift('ระบบ error');
  return miss;
}

const rows = cases.map((c, i) => {
  const id = i + 1;
  const row = { id, q: c.q, expect: JSON.stringify(c.expect || {}).replace(/"/g, ''), hasHistory: !!c.history };
  for (const run of RUNS) {
    const ans = run.data?.find(a => a.id === id);
    if (!ans) { row[run.key] = null; continue; }
    const miss = checkPlan(c.expect || {}, ans);
    row[run.key] = { ok: miss.length === 0, miss: miss.join(' · '), status: ans.auditStatus, sec: +(ans.durationMs / 1000).toFixed(1), reply: ans.reply || '', model: ans.model };
  }
  return row;
});

const wb = new ExcelJS.Workbook();
const F = 'Sarabun';
const C = { ok: 'FFE6F4EA', bad: 'FFFDE2E1', none: 'FFEDEDED', head: 'FF1F4E79' };
const style = (row, color) => { row.eachCell(c => { c.font = { name: F, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color || C.head } }; c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }; }); row.height = 30; };

// Summary
const s = wb.addWorksheet('สรุป', { views: [{ showGridLines: false }] });
s.columns = [{ width: 34 }, ...RUNS.map(() => ({ width: 20 }))];
s.getCell('A1').value = 'เทียบชุด 62 คำถามข้ามโมเดล'; s.getCell('A1').font = { name: F, size: 16, bold: true, color: { argb: C.head } };
s.getCell('A2').value = `รันวันที่ ${date} ด้วยโค้ดเดียวกัน ต่างกันแค่โมเดล · "แผนตรง" = เลือก tool / ช่วงเวลา / หมวด ตรงกับที่คาดไว้ (ยังไม่ได้ตรวจความถูกของเนื้อหาคำตอบ)`;
s.getCell('A2').font = { name: F, size: 10, color: { argb: 'FF666666' } };
s.getRow(4).values = ['', ...RUNS.map(r => r.label)]; style(s.getRow(4));
const stat = (fn) => RUNS.map(r => { const xs = rows.map(x => x[r.key]).filter(Boolean); return xs.length ? fn(xs) : 'ยังไม่ได้รัน'; });
const lines = [
  ['โมเดล', ...RUNS.map(r => r.model)],
  ['จำนวนข้อที่รัน', ...stat(xs => xs.length)],
  ['✅ แผนตรง', ...stat(xs => `${xs.filter(x => x.ok).length} (${Math.round(xs.filter(x => x.ok).length / xs.length * 100)}%)`)],
  ['❌ แผนไม่ตรง', ...stat(xs => xs.filter(x => !x.ok).length)],
  ['⚠️ ระบบ error', ...stat(xs => xs.filter(x => x.status === 'ERROR').length)],
  ['AI เขียนคำตอบเอง (OK)', ...stat(xs => xs.filter(x => x.status === 'OK').length)],
  ['ใช้รูปแบบตายตัว (DETERMINISTIC)', ...stat(xs => xs.filter(x => x.status === 'DETERMINISTIC').length)],
  ['เรียก AI สำเร็จ (ครั้ง)', ...RUNS.map(r => r.log ? `${r.log.count.jaika + r.log.count.cloudflare + r.log.count.ollama}` : '-')],
  ['ไปใช้โมเดลอื่นแทน (fallback)', ...RUNS.map(r => { if (!r.log) return '-'; const own = { cloudflare: 'cloudflare', ollama: 'ollama', jaika: 'jaika', jaika_fix: 'jaika' }[r.key]; return ['jaika', 'cloudflare', 'ollama'].filter(m => m !== own).reduce((a, m) => a + r.log.count[m], 0); })],
  ['AI ตอบไม่ได้ (429/502/503/530/timeout)', ...RUNS.map(r => r.log ? r.log.count.apiErrors : '-')],
  ['ต้องรอแล้วลองซ้ำ', ...RUNS.map(r => r.log ? r.log.count.retries : '-')],
  ['ตัวตรวจไม่ใช้ข้อความ AI (ใช้รูปแบบตายตัวแทน)', ...RUNS.map(r => r.log ? r.log.count.guard : '-')],
  ['เวลาเฉลี่ยต่อข้อ (วินาที)', ...stat(xs => +(xs.reduce((a, x) => a + x.sec, 0) / xs.length).toFixed(1))],
  ['ช้าสุด (วินาที)', ...stat(xs => Math.max(...xs.map(x => x.sec)))],
];
lines.forEach((v, i) => { s.getRow(5 + i).values = v; s.getRow(5 + i).font = { name: F }; s.getRow(5 + i).alignment = { horizontal: 'center', wrapText: true }; s.getCell(`A${5 + i}`).alignment = { horizontal: 'left' }; });
let r = 5 + lines.length + 1;
for (const note of [
  'รอบเดิม 11 พ.ย. รันแค่ 30 ข้อแรก และใช้โค้ดก่อนแก้ (ก่อน commit 9c8bbce) จึงเทียบโมเดลได้ไม่ตรงนัก ใช้ดูว่าโค้ดใหม่ดีขึ้นแค่ไหน',
  'คำถามที่มีคำว่า "วันนี้" ตอบตามข้อมูล ณ เวลาที่รัน ถ้ามีแชตใหม่เข้ามาระหว่างรอบ ตัวเลขอาจต่างกันได้',
  `Cloudflare ใช้โมเดลคนละตัวกับ Jaika (${RUNS[1].model}) และตอนเทสขยายเวลารอเป็น 2 นาที (บอทจริงตัดที่ 10 วินาทีแล้วไปใช้ Ollama)`,
  'ชีต "บันทึกการรัน" รวม error และคำเตือนจาก log แยกตามข้อ: ตัวตรวจไม่ใช้ข้อความ AI เมื่อ AI เขียนตัวเลข/ชื่อหมวดไม่ตรงข้อมูล หรือมีคำอังกฤษหลุด คำตอบที่ผู้ใช้เห็นจึงยังถูก แค่สำนวนเป็นแบบตายตัว',
  'คำเตือน "Category mismatch" ใน log เป็นการเตือนผิด (ตัวตรวจไปจับตัวเลขในวันที่ เช่น 2026-11-11) จึงไม่นับในชีต',
  'ชีต "เทียบรายข้อ" กรองได้ เช่น ดูเฉพาะข้อที่ Jaika แผนไม่ตรง; ช่อง "หมายเหตุผู้ตรวจ" เว้นไว้ให้มิกะเขียน',
]) { s.getCell(`A${r}`).value = '• ' + note; s.getCell(`A${r}`).font = { name: F, size: 10 }; s.mergeCells(`A${r}:E${r}`); s.getRow(r).height = 30; s.getCell(`A${r}`).alignment = { wrapText: true, vertical: 'top' }; r++; }

// Per question
const d = wb.addWorksheet('เทียบรายข้อ', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });
const cols = [{ key: 'id', width: 6 }, { key: 'q', width: 40 }, { key: 'expect', width: 26 }];
for (const run of RUNS) cols.push({ key: `${run.key}_ok`, width: 10 }, { key: `${run.key}_miss`, width: 28 }, { key: `${run.key}_sec`, width: 8 }, { key: `${run.key}_reply`, width: 55 });
cols.push({ key: 'note', width: 30 });
d.columns = cols;
// Two header rows: model name spanning its 4 columns, then field names
const top = ['ข้อ', 'คำถาม', 'ที่คาดไว้'];
const sub = ['', '', ''];
for (const run of RUNS) { top.push(run.label, '', '', ''); sub.push('แผนตรง', 'ส่วนที่ไม่ตรง', 'วินาที', 'คำตอบ'); }
top.push('หมายเหตุผู้ตรวจ'); sub.push('');
d.getRow(1).values = top; d.getRow(2).values = sub;
const runColors = ['FF5B6770', 'FFB45309', 'FF1D4ED8', 'FF047857', 'FF065F46'];
style(d.getRow(1)); style(d.getRow(2), 'FF2F5F8F');
RUNS.forEach((run, i) => {
  const start = 4 + i * 4;
  d.mergeCells(1, start, 1, start + 3);
  d.getRow(1).getCell(start).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: runColors[i] } };
});
for (const k of [1, 2, 3, cols.length]) d.mergeCells(1, k, 2, k);
for (const x of rows) {
  const vals = [x.id, x.q + (x.hasHistory ? ' (มีบริบทคำถามก่อน)' : ''), x.expect];
  for (const run of RUNS) {
    const v = x[run.key];
    vals.push(v ? (v.ok ? '✓' : '✗') : '-', v ? v.miss : 'ยังไม่ได้รัน', v ? v.sec : '', v ? v.reply.slice(0, 2000) : '');
  }
  vals.push('');
  const row = d.addRow(vals);
  row.font = { name: F, size: 10 };
  row.alignment = { wrapText: true, vertical: 'top' };
  RUNS.forEach((run, i) => {
    const v = x[run.key];
    row.getCell(4 + i * 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: !v ? C.none : v.ok ? C.ok : C.bad } };
    row.getCell(4 + i * 4).alignment = { horizontal: 'center', vertical: 'top' };
  });
  row.height = 90;
}
d.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };

// Run log: errors and the answer checker's warnings, per question
const lg = wb.addWorksheet('บันทึกการรัน', { views: [{ state: 'frozen', ySplit: 1 }] });
lg.columns = [{ header: 'โมเดล', width: 24 }, { header: 'ข้อ', width: 6 }, { header: 'คำถาม', width: 38 }, { header: 'ประเภท', width: 34 }, { header: 'ข้อความจาก log', width: 90 }];
style(lg.getRow(1));
const kindColor = { 'ระบบ error': C.bad, 'AI ตอบไม่ได้ (API error)': C.bad, 'รอแล้วลองซ้ำ': 'FFFFF4CC', 'ตัวตรวจไม่ใช้ข้อความ AI → ใช้รูปแบบตายตัว': 'FFFFF4CC' };
for (const run of RUNS) {
  if (!run.log) continue;
  if (!run.log.events.length) { const row = lg.addRow([run.label, '', '', 'ไม่มี error หรือคำเตือน', '']); row.font = { name: F, size: 10 }; row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.ok } }; continue; }
  for (const e of run.log.events) {
    const row = lg.addRow([run.label, e.q || '', e.q ? cases[e.q - 1]?.q || '' : '', e.kind, e.text]);
    row.font = { name: F, size: 10 }; row.alignment = { wrapText: true, vertical: 'top' };
    if (kindColor[e.kind]) row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kindColor[e.kind] } };
  }
}
lg.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } };

wb.xlsx.writeFile(outFile).then(() => {
  console.log(`saved ${outFile}`);
  for (const run of RUNS) {
    const xs = rows.map(x => x[run.key]).filter(Boolean);
    console.log(`${run.label}: ${xs.length ? `${xs.filter(x => x.ok).length}/${xs.length} plan ok, ${xs.filter(x => x.status === 'ERROR').length} errors, avg ${(xs.reduce((a, x) => a + x.sec, 0) / xs.length).toFixed(1)}s` : 'not run'}`);
  }
});
