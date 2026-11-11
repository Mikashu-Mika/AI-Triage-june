import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

/**
 * Generate formatted Excel (.xlsx) report for chat issue drilldowns
 * @param {string} title
 * @param {Array} items
 * @param {string} periodLabel
 * @returns {Promise<string>} File path of generated Excel file
 */
export async function generateExcelReport(title = 'รายงานปัญหา', items = [], periodLabel = 'ปัจจุบัน') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mikashu Sift AI Bot';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('รายงานสรุปปัญหา');

  // 1. Sort chronologically by date/time (เรียงตามลำดับวันที่และเวลา จากเก่าไปใหม่: 1 -> 31)
  const sortedItems = [...items].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Count key metrics
  const totalIssues = sortedItems.length;
  const uniqueChats = new Set(sortedItems.map(i => i.chat_id)).size;
  const urgentCount = sortedItems.filter(i => (i.priority || '').toLowerCase() === 'urgent').length;
  const highCount = sortedItems.filter(i => (i.priority || '').toLowerCase() === 'high').length;
  const medCount = sortedItems.filter(i => (i.priority || '').toLowerCase() === 'medium').length;
  const lowCount = sortedItems.filter(i => (i.priority || '').toLowerCase() === 'low').length;

  // Row 1: Title
  worksheet.mergeCells('A1:I1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = `📊 รายงานสรุปรายละเอียดปัญหา - ${title}`;
  titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A60' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(1).height = 36;

  // Row 2: Subtitle / Period
  worksheet.mergeCells('A2:I2');
  const subCell = worksheet.getCell('A2');
  subCell.value = `ช่วงเวลาข้อมูล: ${periodLabel} | สร้างเมื่อ: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} น.`;
  subCell.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF555555' } };
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } };
  subCell.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(2).height = 20;

  // Row 3: KPI Metrics Banner
  worksheet.mergeCells('A3:I3');
  const kpiCell = worksheet.getCell('A3');
  kpiCell.value = `📌 สรุปภาพรวม: รวม ${totalIssues} ปัญหา (จาก ${uniqueChats} แชต) | 🚨 ฉุกเฉิน: ${urgentCount} | 🔥 สูง: ${highCount} | ⚡ ปานกลาง: ${medCount} | 🟢 ปกติ: ${lowCount}`;
  kpiCell.font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FF1F3A60' } };
  kpiCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2ECF6' } };
  kpiCell.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(3).height = 24;

  // Row 4: Empty separator
  worksheet.getRow(4).height = 8;

  // Row 5: Table Headers
  const headers = [
    'ลำดับ',
    'วันที่เกิดเรื่อง',
    'เวลา',
    'รหัสแชต (Chat ID)',
    'รหัสลูกค้า',
    'หมวดหมู่ปัญหา',
    'ระดับความด่วน',
    'อารมณ์ลูกค้า',
    'รายละเอียดข้อความปัญหา'
  ];

  const headerRow = worksheet.getRow(5);
  headerRow.values = headers;
  headerRow.font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2A5298' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 26;

  // Helper for cleaning URLs out of summary
  const cleanSummary = text => {
    if (!text) return '-';
    return String(text)
      .replace(/https?:\/\/\S+/g, '[📷 แนบภาพ/สลิป]')
      .trim();
  };

  // Helper for priority display & styling
  const priorityInfo = p => {
    const key = (p || '').toLowerCase();
    if (key === 'urgent') return { text: '🚨 ฉุกเฉิน (URGENT)', bg: 'FFFFEBEE', fg: 'FFC62828' };
    if (key === 'high') return { text: '🔥 สูง (HIGH)', bg: 'FFFFF3E0', fg: 'FFE65100' };
    if (key === 'medium') return { text: '⚡ ปานกลาง (MEDIUM)', bg: 'FFFFFDE7', fg: 'FFF57F17' };
    return { text: '🟢 ปกติ (LOW)', bg: 'FFE8F5E9', fg: 'FF2E7D32' };
  };

  // Helper for sentiment display
  const sentimentInfo = s => {
    const key = (s || '').toLowerCase();
    if (key === 'negative') return '😡 ไม่พอใจ';
    if (key === 'positive') return '😊 พอใจ';
    return '😐 ทั่วไป';
  };

  // Populate Data Rows starting from row 6
  sortedItems.forEach((item, index) => {
    const d = item.created_at ? new Date(item.created_at) : null;
    const dateFormatted = d ? d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
    const timeFormatted = d ? d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' น.' : '-';

    const prio = priorityInfo(item.priority);
    const sent = sentimentInfo(item.sentiment);
    const summary = cleanSummary(item.summary);

    const row = worksheet.addRow([
      index + 1,
      dateFormatted,
      timeFormatted,
      item.chat_id || item.id || '-',
      item.customer_id || '-',
      item.category_name || item.category_id || title || '-',
      prio.text,
      sent,
      summary
    ]);

    row.font = { name: 'Segoe UI', size: 9.5 };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.height = 24;

    // Center alignment for code/date/status columns
    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(3).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(4).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(5).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(6).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(7).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(8).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(9).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

    // Priority cell styling
    const prioCell = row.getCell(7);
    prioCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: prio.bg } };
    prioCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: prio.fg } };

    // Zebra striping for non-priority cells
    const zebraBg = index % 2 === 1 ? 'FFF8F9FA' : 'FFFFFFFF';
    [1, 2, 3, 4, 5, 6, 8, 9].forEach(colIdx => {
      row.getCell(colIdx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebraBg } };
    });

    // Thin borders
    for (let c = 1; c <= 9; c++) {
      row.getCell(c).border = {
        top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
      };
    }
  });

  // Freeze panes at header row (แถว 5)
  worksheet.views = [
    { state: 'frozen', xSplit: 0, ySplit: 5, activeCell: 'A6' }
  ];

  // Auto filter for columns A to I
  worksheet.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: 5 + sortedItems.length, column: 9 }
  };

  // Set explicit column widths
  worksheet.getColumn(1).width = 8;   // ลำดับ
  worksheet.getColumn(2).width = 16;  // วันที่
  worksheet.getColumn(3).width = 15;  // เวลา
  worksheet.getColumn(4).width = 24;  // Chat ID
  worksheet.getColumn(5).width = 18;  // Customer ID
  worksheet.getColumn(6).width = 24;  // Category
  worksheet.getColumn(7).width = 22;  // Priority
  worksheet.getColumn(8).width = 16;  // Sentiment
  worksheet.getColumn(9).width = 65;  // Summary

  // Save to scratch directory
  const scratchDir = path.resolve('scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

  const safeTitle = title.replace(/[^\w\u0E00-\u0E7F]/g, '_').substring(0, 30);
  const fileName = `รายงานแชตปัญหา_${safeTitle}_${Date.now()}.xlsx`;
  const filePath = path.join(scratchDir, fileName);

  await workbook.xlsx.writeFile(filePath);
  return filePath;
}
