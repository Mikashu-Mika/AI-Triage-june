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
  workbook.creator = 'Mikashu AI Triage Bot';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('รายงานสรุปปัญหา');

  // Title Row
  worksheet.mergeCells('A1:F1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = `📊 รายงานสรุปรายละเอียดปัญหา - ${title} (${periodLabel})`;
  titleCell.font = { name: 'Tahoma', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(1).height = 35;

  // Header Row
  const headerRow = worksheet.getRow(3);
  headerRow.values = ['ลำดับ', 'วันที่-เวลาที่เกิดปัญหา', 'รหัสแชต (Chat ID)', 'หมวดหมู่ปัญหา', 'รายละเอียดข้อความปัญหา', 'ระดับความด่วน'];
  headerRow.font = { name: 'Tahoma', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Data Rows
  items.forEach((item, index) => {
    const dateStr = item.created_at ? new Date(item.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-';
    const row = worksheet.addRow([
      index + 1,
      dateStr,
      item.chat_id || item.id || '-',
      item.category_name || item.category_id || title || '-',
      item.summary || item.text || '-',
      (item.priority || 'low').toUpperCase()
    ]);

    row.font = { name: 'Tahoma', size: 10 };
    row.alignment = { vertical: 'middle', wrapText: true };
    if (index % 2 === 1) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    }
  });

  // Set Column Widths
  worksheet.getColumn(1).width = 10;
  worksheet.getColumn(2).width = 22;
  worksheet.getColumn(3).width = 18;
  worksheet.getColumn(4).width = 25;
  worksheet.getColumn(5).width = 55;
  worksheet.getColumn(6).width = 15;

  // Save to scratch directory
  const scratchDir = path.resolve('scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

  const safeTitle = title.replace(/[^\w\u0E00-\u0E7F]/g, '_').substring(0, 30);
  const fileName = `รายงานแชตปัญหา_${safeTitle}_${Date.now()}.xlsx`;
  const filePath = path.join(scratchDir, fileName);

  await workbook.xlsx.writeFile(filePath);
  return filePath;
}
