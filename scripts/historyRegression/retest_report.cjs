// Before/after Excel for the re-test of the questions that failed or partly passed.
// Usage: node scripts/historyRegression/retest_report.cjs <dir> <out.xlsx>
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const [, , dir, outFile] = process.argv;
const rows = fs.readFileSync(path.join(dir, 'retest_2026-11-14.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const g = JSON.parse(fs.readFileSync(path.join(dir, 'retest_grades.json'), 'utf8'));
const TH = { P: 'ผ่าน', H: 'ผ่านบางส่วน', F: 'ไม่ผ่าน', X: 'ไม่ได้เทส (Jaika ล่ม)' };
const COLOR = { P: 'FFE6F4EA', H: 'FFFFF4D6', F: 'FFFDE2E1', X: 'FFEDEDED' };
const items = rows.map(r => {
  const after = r.status === 'ERROR' ? 'X' : (g[r.id]?.[0] || 'X');
  return { id: r.id, q: r.q, ctx: r.historyQs[0] || '', before: r.before.verdict, beforeReason: r.before.reason, after, afterReason: r.status === 'ERROR' ? 'Jaika ต่อไม่ได้ (530 Cloudflare Tunnel) ระหว่างเทส' : g[r.id]?.[1] || '', reply: r.reply || '' };
});
const tested = items.filter(i => i.after !== 'X');
const cnt = (a, k, v) => a.filter(i => i[k] === v).length;
const wb = new ExcelJS.Workbook();
const F = 'Sarabun';
const hdr = (ws, n) => { ws.getRow(n).eachCell(c => { c.font = { name: F, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }; c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }; }); ws.getRow(n).height = 28; };
const s = wb.addWorksheet('สรุปก่อน-หลังแก้', { views: [{ showGridLines: false }] });
s.columns = [{ width: 38 }, { width: 14 }, { width: 14 }, { width: 14 }];
s.getCell('A1').value = 'ผลเทสซ้ำข้อที่ต้องแก้ (หลังแก้โค้ดบอท)'; s.getCell('A1').font = { name: F, size: 16, bold: true, color: { argb: 'FF1F4E79' } };
s.getCell('A2').value = '14 พ.ย. 2569 · ถามคำถามก่อนหน้าก่อนทุกข้อ ให้บริบทเหมือนเดิม · ใช้ AI Jaika เท่านั้น'; s.getCell('A2').font = { name: F, size: 10, color: { argb: 'FF666666' } };
s.getRow(4).values = ['', 'ก่อนแก้', 'หลังแก้']; hdr(s, 4);
const rowsSum = [['ข้อที่เทสซ้ำได้', tested.length, tested.length], ['✅ ผ่าน', cnt(tested, 'before', 'P'), cnt(tested, 'after', 'P')], ['🟡 ผ่านบางส่วน', cnt(tested, 'before', 'H'), cnt(tested, 'after', 'H')], ['❌ ไม่ผ่าน', cnt(tested, 'before', 'F'), cnt(tested, 'after', 'F')]];
rowsSum.forEach((v, i) => { s.getRow(5 + i).values = v; s.getRow(5 + i).font = { name: F }; });
s.getCell('A10').value = `ไม่ได้เทส ${cnt(items, 'after', 'X')} ข้อ เพราะ Jaika ต่อไม่ได้ระหว่างรัน (ยังเป็นผลก่อนแก้)`; s.getCell('A10').font = { name: F, size: 10 };
s.getCell('A11').value = 'ข้อที่หมายเหตุว่า "แก้แล้วหลังเทส" ตรวจด้วยเทสหน่วยแล้ว แต่ยังไม่ได้ถาม Jaika ซ้ำ'; s.getCell('A11').font = { name: F, size: 10 };
const d = wb.addWorksheet('รายข้อ', { views: [{ state: 'frozen', ySplit: 1 }] });
d.columns = [{ header: 'คำถาม', key: 'q', width: 42 }, { header: 'คำถามก่อนหน้า', key: 'ctx', width: 26 }, { header: 'ก่อนแก้', key: 'b', width: 13 }, { header: 'ปัญหาเดิม', key: 'beforeReason', width: 45 }, { header: 'หลังแก้', key: 'a', width: 16 }, { header: 'ผลหลังแก้ / หมายเหตุ', key: 'afterReason', width: 50 }, { header: 'คำตอบใหม่', key: 'reply', width: 70 }];
hdr(d, 1);
const order = { F: 0, H: 1, X: 2, P: 3 };
for (const i of items.sort((x, y) => order[x.after] - order[y.after])) {
  const row = d.addRow({ ...i, b: TH[i.before], a: TH[i.after], reply: i.reply.slice(0, 2500) });
  row.font = { name: F, size: 10 }; row.alignment = { wrapText: true, vertical: 'top' };
  row.getCell('b').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR[i.before] } };
  row.getCell('a').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR[i.after] } };
  row.height = Math.min(140, Math.max(30, Math.ceil(i.reply.length / 90) * 13));
}
d.autoFilter = { from: 'A1', to: 'G1' };
wb.xlsx.writeFile(outFile).then(() => console.log(JSON.stringify({ total: items.length, tested: tested.length, before: { P: cnt(tested, 'before', 'P'), H: cnt(tested, 'before', 'H'), F: cnt(tested, 'before', 'F') }, after: { P: cnt(tested, 'after', 'P'), H: cnt(tested, 'after', 'H'), F: cnt(tested, 'after', 'F') }, notTested: cnt(items, 'after', 'X') })));
