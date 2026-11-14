// Builds the Excel report for the Telegram-history regression run.
// Usage: node scripts/historyRegression/report.cjs <dir> <results.jsonl> <out.xlsx>
// Reads grades_part*.json in <dir>: { "<message id>": [type, "P"|"H"|"F", reason] }.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const [, , dir, resultsFile, outFile] = process.argv;
const rows = fs.readFileSync(resultsFile, 'utf8').trim().split('\n').map(JSON.parse);
const questions = JSON.parse(fs.readFileSync(path.join(dir, 'questions_all.json'), 'utf8'));
const grades = {};
for (const f of fs.readdirSync(dir).filter(f => /^grades_part\d+\.json$/.test(f)).sort()) {
  Object.assign(grades, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

const JAIKA_DOWN = /temporarily unavailable|model_unavailable|Connection error|local rate limit|timed? ?out|Bad gateway|origin_bad_gateway|\b50[234]\b/i;
const isJaikaDown = r => r.status === 'ERROR' || r.logs.some(l => JAIKA_DOWN.test(l) && !l.includes('[AI Jaika only]'));

const TYPE_TH = {
  data: 'คำถามข้อมูล', follow: 'คำถามต่อเนื่อง (ใช้บริบท)', nodata: 'ถามข้อมูลที่ระบบไม่มี',
  personal: 'ขอข้อมูลส่วนตัวลูกค้า', chat: 'คุยเล่น/ทักทาย/ไม่ใช่คำถาม',
};
const VERDICT_TH = { P: 'ผ่าน', H: 'ผ่านบางส่วน', F: 'ไม่ผ่าน', X: 'ไม่ได้เทส (Jaika ล่ม)' };

// Group each finding into a root-cause theme so fixes can be planned per theme.
function theme(verdict, reason) {
  if (verdict === 'P' || verdict === 'X') return '';
  if (/จากคำถามก่อน|เปลี่ยนเป็น 'วันนี้'|ตามบริบทก่อนหน้า/.test(reason)) return 'บริบทค้าง/หลุดจากคำถามก่อน';
  if (/100%/.test(reason)) return "แสดง '100%' เมื่อกรองหมวดเดียว";
  if (/'ชม'|'ชื่นชม'|พอใจกี่ราย/.test(reason)) return 'ข้อมูลแชตเชิงบวก/ชม ไม่ตรง';
  if (/ไม่มีข้อมูล/.test(reason)) return 'ข้อมูลที่ระบบไม่มี แต่ตอบเหมือนมี';
  if (/ลูกค้าทั้งหมด ณ|ลูกค้าเดือนสิงหา|การสนทนา 239|ลูกค้าที่ทักซ้ำแทน/.test(reason)) return 'สถิติลูกค้าตอบผิดคำถาม';
  if (/อธิบาย|เหตุผล|สาเหตุ|ทำไม/.test(reason)) return "คำถาม 'ทำไม/อธิบาย' ตอบไม่ตรง";
  if (/ขอบคุณ|ทดสอบ|ไม่ใช่คำถาม|วันอะไร|ควรถามกลับ|ควรรอคำถาม/.test(reason)) return 'ตีความข้อความสั้น/คุยเล่นผิด';
  if (/ไม่ได้กรอง|ทุกหมวด|ไม่ได้ระบุช่วงเวลา/.test(reason)) return 'ไม่กรองหมวด/ช่วงเวลาตามที่ถาม';
  if (/เพี้ยน|ภาษาอังกฤษ|รูปแบบ|หัวข้อ|หน่วยปน|'อีก 3 หมวด'|'อีก 9 หมวด'|ข้อความสรุปขาด/.test(reason)) return 'รูปแบบ/ข้อความในคำตอบผิด';
  if (/ไม่ตรงกัน/.test(reason)) return 'ตัวเลขไม่ตรงกันระหว่างคำตอบ';
  return 'ตอบไม่ครบตามที่ถาม';
}

const byId = new Map(rows.map(r => [r.id, r]));
const items = [];
const seenQ = new Set();
const norm = s => s.toLowerCase().replace(/[\s?!.,ๆ]/g, '');
for (const q of questions) {
  if (seenQ.has(norm(q.q))) continue;
  seenQ.add(norm(q.q));
  const r = rows.find(x => norm(x.q) === norm(q.q)) || byId.get(q.id);
  let verdict, type, reason;
  if (!r) { verdict = 'X'; type = ''; reason = 'ยังไม่ได้รัน (หยุดก่อนถึงข้อนี้)'; }
  else if (isJaikaDown(r)) { verdict = 'X'; type = grades[r.id]?.[0] || ''; reason = 'Jaika ตอบ 502/503 ระหว่างเทส ข้อนี้จึงไม่มีคำตอบให้ตรวจ'; }
  else if (grades[r.id]) { [type, verdict, reason] = grades[r.id]; }
  else { verdict = 'X'; type = ''; reason = 'ยังไม่ได้ตรวจ'; }
  const calls = (r?.calls || []).map(c => `${c.tool}(${JSON.stringify(c.args || {}).replace(/"/g, '')})`).join('\n');
  items.push({
    no: items.length + 1, id: q.id, date: q.date.slice(0, 10), from: q.from, q: q.q,
    context: (r?.historyQs || []).slice(-1)[0] || '',
    type, typeTh: TYPE_TH[type] || '-', verdict, verdictTh: VERDICT_TH[verdict], reason,
    theme: theme(verdict, reason),
    tool: r?.tool || '', calls, status: r?.status || '', sec: r?.sec ?? '',
    reply: r?.reply || r?.error || '', orig: q.origReply || '',
  });
}

const tested = items.filter(i => i.verdict !== 'X');
const count = (arr, v) => arr.filter(i => i.verdict === v).length;
const pct = (n, d) => (d ? n / d : 0);

const wb = new ExcelJS.Workbook();
wb.creator = 'SIFT AI regression';
const FONT = 'Sarabun';
const COLORS = { P: 'FFE6F4EA', H: 'FFFFF4D6', F: 'FFFDE2E1', X: 'FFEDEDED' };
const header = (ws, rowNo) => {
  const row = ws.getRow(rowNo);
  row.eachCell(c => {
    c.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  row.height = 30;
};
const title = (ws, text, sub) => {
  ws.getCell('A1').value = text;
  ws.getCell('A1').font = { name: FONT, size: 16, bold: true, color: { argb: 'FF1F4E79' } };
  if (sub) { ws.getCell('A2').value = sub; ws.getCell('A2').font = { name: FONT, size: 10, color: { argb: 'FF666666' } }; }
};

// ---- Sheet 1: summary
const s = wb.addWorksheet('สรุปผล', { views: [{ showGridLines: false }] });
s.columns = [{ width: 40 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
title(s, 'ผลเทสซ้ำคำถามจากกลุ่ม Test_SIFT_AI', `คำถามจากแชต 14 ส.ค. – 14 พ.ย. 2569 · รันใหม่วันที่ 14 พ.ย. 2569 ด้วย AI Jaika (qwen2.5-14b) เท่านั้น`);
let r = 4;
const kv = [
  ['คำถามทั้งหมด (ตัดซ้ำแล้ว)', items.length],
  ['ตรวจได้ (Jaika ตอบครบ)', tested.length],
  ['ไม่ได้เทส (Jaika ล่ม 502/503)', count(items, 'X')],
  ['✅ ผ่าน', count(tested, 'P')],
  ['🟡 ผ่านบางส่วน', count(tested, 'H')],
  ['❌ ไม่ผ่าน', count(tested, 'F')],
];
s.getCell(`A${r}`).value = 'ภาพรวม'; s.getCell(`A${r}`).font = { name: FONT, bold: true, size: 12 }; r++;
s.getRow(r).values = ['รายการ', 'จำนวน', '% ของที่ตรวจได้']; header(s, r); r++;
for (const [k, v] of kv) {
  const isVerdict = /ผ่าน/.test(k);
  s.getRow(r).values = [k, v, isVerdict ? pct(v, tested.length) : ''];
  s.getCell(`C${r}`).numFmt = '0.0%';
  s.getRow(r).font = { name: FONT };
  r++;
}
r++;
s.getCell(`A${r}`).value = 'แยกตามประเภทคำถาม'; s.getCell(`A${r}`).font = { name: FONT, bold: true, size: 12 }; r++;
s.getRow(r).values = ['ประเภท', 'ตรวจได้', 'ผ่าน', 'ผ่านบางส่วน', 'ไม่ผ่าน', '% ผ่าน']; header(s, r); r++;
for (const t of Object.keys(TYPE_TH)) {
  const arr = tested.filter(i => i.type === t);
  s.getRow(r).values = [TYPE_TH[t], arr.length, count(arr, 'P'), count(arr, 'H'), count(arr, 'F'), pct(count(arr, 'P'), arr.length)];
  s.getCell(`F${r}`).numFmt = '0.0%';
  s.getRow(r).font = { name: FONT };
  r++;
}
r++;
s.getCell(`A${r}`).value = 'กลุ่มปัญหาที่พบ (ข้อที่ไม่ผ่าน + ผ่านบางส่วน)'; s.getCell(`A${r}`).font = { name: FONT, bold: true, size: 12 }; r++;
s.getRow(r).values = ['กลุ่มปัญหา', 'ไม่ผ่าน', 'ผ่านบางส่วน', 'รวม', 'ตัวอย่างข้อ (ลำดับ)']; header(s, r); r++;
const themes = {};
for (const i of tested.filter(i => i.theme)) {
  themes[i.theme] ||= { F: 0, H: 0, ex: [] };
  themes[i.theme][i.verdict]++;
  if (themes[i.theme].ex.length < 6) themes[i.theme].ex.push(i.no);
}
for (const [k, v] of Object.entries(themes).sort((a, b) => (b[1].F + b[1].H) - (a[1].F + a[1].H))) {
  s.getRow(r).values = [k, v.F, v.H, v.F + v.H, v.ex.join(', ')];
  s.getRow(r).font = { name: FONT };
  r++;
}
r++;
s.getCell(`A${r}`).value = 'วิธีอ่านไฟล์'; s.getCell(`A${r}`).font = { name: FONT, bold: true, size: 12 }; r++;
for (const line of [
  'ผ่าน = เลือกข้อมูล/ช่วงเวลาถูก ตัวเลขสมเหตุสมผล และตอบตรงคำถาม',
  'ผ่านบางส่วน = ตัวเลขหลักถูก แต่ตอบไม่ครบ รูปแบบผิด หรือมีข้อความชวนเข้าใจผิด',
  'ไม่ผ่าน = ตอบผิดคำถาม ตัวเลขผิด หรือแต่งข้อมูลที่ระบบไม่มี',
  'คำถามที่มีคำว่า "วันนี้/เดือนนี้" ถูกตอบตามวันที่รันเทส (14 พ.ย. 2569) ไม่ใช่วันที่ถามเดิม',
  'ชีต "รายละเอียดทุกข้อ" กรองตามผลตรวจ/ประเภท/กลุ่มปัญหาได้ (ปุ่มลูกศรที่หัวตาราง)',
]) { s.getCell(`A${r}`).value = '• ' + line; s.getCell(`A${r}`).font = { name: FONT, size: 10 }; s.mergeCells(`A${r}:F${r}`); r++; }

// ---- Sheet 2: every question
const d = wb.addWorksheet('รายละเอียดทุกข้อ', { views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });
d.columns = [
  { header: 'ลำดับ', key: 'no', width: 7 },
  { header: 'ผลตรวจ', key: 'verdictTh', width: 13 },
  { header: 'ประเภทคำถาม', key: 'typeTh', width: 20 },
  { header: 'คำถาม', key: 'q', width: 42 },
  { header: 'คำถามก่อนหน้า (บริบท)', key: 'context', width: 28 },
  { header: 'เหตุผล / สิ่งที่ผิด', key: 'reason', width: 48 },
  { header: 'กลุ่มปัญหา', key: 'theme', width: 26 },
  { header: 'คำตอบใหม่ (Jaika)', key: 'reply', width: 70 },
  { header: 'Tool และตัวกรองที่บอทเลือก', key: 'calls', width: 40 },
  { header: 'สถานะ', key: 'status', width: 14 },
  { header: 'เวลา (วินาที)', key: 'sec', width: 10 },
  { header: 'วันที่ถามเดิม', key: 'date', width: 12 },
  { header: 'ผู้ถาม', key: 'from', width: 12 },
  { header: 'คำตอบเดิมในกลุ่ม (ตอนถามจริง)', key: 'orig', width: 60 },
];
header(d, 1);
for (const i of items) {
  const row = d.addRow({ ...i, reply: i.reply.slice(0, 3000), orig: i.orig.slice(0, 1500) });
  row.font = { name: FONT, size: 10 };
  row.alignment = { vertical: 'top', wrapText: true };
  row.getCell('verdictTh').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS[i.verdict] } };
  row.getCell('verdictTh').font = { name: FONT, size: 10, bold: true };
  row.height = Math.min(150, Math.max(30, Math.ceil(i.reply.length / 90) * 13));
}
d.autoFilter = { from: 'A1', to: 'N1' };

// ---- Sheet 3: findings to fix
const f = wb.addWorksheet('ข้อที่ต้องแก้', { views: [{ state: 'frozen', ySplit: 1 }] });
f.columns = [
  { header: 'กลุ่มปัญหา', key: 'theme', width: 28 },
  { header: 'ผลตรวจ', key: 'verdictTh', width: 13 },
  { header: 'ลำดับ', key: 'no', width: 7 },
  { header: 'คำถาม', key: 'q', width: 45 },
  { header: 'เหตุผล / สิ่งที่ผิด', key: 'reason', width: 60 },
  { header: 'คำตอบใหม่ (ย่อ)', key: 'reply', width: 60 },
];
header(f, 1);
for (const i of tested.filter(i => i.verdict !== 'P').sort((a, b) => a.theme.localeCompare(b.theme, 'th') || a.verdict.localeCompare(b.verdict))) {
  const row = f.addRow({ ...i, reply: i.reply.slice(0, 400) });
  row.font = { name: FONT, size: 10 };
  row.alignment = { vertical: 'top', wrapText: true };
  row.getCell('verdictTh').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS[i.verdict] } };
}
f.autoFilter = { from: 'A1', to: 'F1' };

wb.xlsx.writeFile(outFile).then(() => {
  console.log(JSON.stringify({
    total: items.length, tested: tested.length, P: count(tested, 'P'), H: count(tested, 'H'), F: count(tested, 'F'),
    notTested: count(items, 'X'), ungraded: items.filter(i => i.reason === 'ยังไม่ได้ตรวจ').length, themes: Object.fromEntries(Object.entries(themes).map(([k, v]) => [k, v.F + v.H])),
  }, null, 1));
});
