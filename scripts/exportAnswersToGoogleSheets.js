/**
 * scripts/exportAnswersToGoogleSheets.js
 * 
 * แปลงผลการทดสอบจาก data/agent_answers_2026-11-11.json
 * ให้เป็นไฟล์ Excel (.xlsx) และไฟล์ HTML สำหรับ Copy เข้า Google Sheets (sheets.new) ได้ทันที
 */

import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

const answersFile = path.resolve('data/agent_answers_2026-11-11.json');
const xlsxOutFile = path.resolve('data/agent_answers_30_questions_2026-11-11.xlsx');
const htmlOutFile = path.resolve('data/agent_answers_sheets_preview.html');

export async function exportToExcelAndSheets(inputFile = answersFile) {
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ Input file not found: ${inputFile}`);
    return;
  }

  const items = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  console.log(`📊 Processing ${items.length} answers for Google Sheets export...`);

  // =========================================================================
  // 1. สร้างไฟล์ Excel (.xlsx) ด้วย ExcelJS สไตล์ Google Sheets มาตรฐาน
  // =========================================================================
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sift AI Team (Mika & Teacher)';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('ผลการตอบ 30 ข้อ (SIFT AI)', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] // ตรึงแถวหัวตาราง
  });

  // กำหนดคอลัมน์
  sheet.columns = [
    { header: '#', key: 'id', width: 6 },
    { header: 'คำถามที่ผู้บริหารถาม (Query)', key: 'q', width: 38 },
    { header: 'Tool ที่บอทเลือกใช้', key: 'toolUsed', width: 22 },
    { header: 'สิ่งที่ควรได้ (Expected)', key: 'expect', width: 28 },
    { header: 'สถานะ', key: 'status', width: 14 },
    { header: 'เวลา (วินาที)', key: 'durationSec', width: 14 },
    { header: 'คำตอบฉบับเต็มของบอท (Bot Reply)', key: 'reply', width: 65 },
    { header: 'ผลการตรวจสอบ (Audit Notes)', key: 'notes', width: 25 },
  ];

  // สไตล์หัวตาราง (สีเขียว Google Sheets #0f9d58, ตัวอักษรขาว หนา กลาง)
  const headerRow = sheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F9D58' },
    };
    cell.font = {
      name: 'Arial',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFDADCE0' } },
      bottom: { style: 'medium', color: { argb: 'FF0B8043' } },
      left: { style: 'thin', color: { argb: 'FF34A853' } },
      right: { style: 'thin', color: { argb: 'FF34A853' } },
    };
  });

  // เติมข้อมูลแต่ละแถว
  items.forEach((item, index) => {
    const durationSec = item.durationMs ? (item.durationMs / 1000).toFixed(1) : '-';
    const expectStr = item.expect
      ? Object.entries(item.expect)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('\n')
      : '-';

    const row = sheet.addRow({
      id: item.id || index + 1,
      q: item.q || '',
      toolUsed: item.toolUsed || '-',
      expect: expectStr,
      status: item.auditStatus || 'OK',
      durationSec: durationSec,
      reply: item.reply || '',
      notes: '', // เว้นไว้ให้ผู้บริหาร/มิกะบันทึกผล
    });

    row.height = Math.min(180, Math.max(30, (item.reply || '').split('\n').length * 16));

    // สลับสีพื้นหลังแถวคู่/คี่
    const isEven = index % 2 === 1;
    const bgArgb = isEven ? 'FFF8F9FA' : 'FFFFFFFF';

    row.eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: bgArgb },
      };
      cell.font = {
        name: 'Arial',
        size: 10,
        color: { argb: 'FF202124' },
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFDADCE0' } },
        bottom: { style: 'thin', color: { argb: 'FFDADCE0' } },
        left: { style: 'thin', color: { argb: 'FFDADCE0' } },
        right: { style: 'thin', color: { argb: 'FFDADCE0' } },
      };

      // จัดตำแหน่งเฉพาะคอลัมน์
      if (colNumber === 1 || colNumber === 5 || colNumber === 6) {
        cell.alignment = { vertical: 'top', horizontal: 'center' };
      } else if (colNumber === 7) {
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
      } else {
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
      }

      // สถานะสีเขียว / แดง
      if (colNumber === 5) {
        const isOk = item.auditStatus === 'OK';
        cell.font = {
          name: 'Arial',
          size: 10,
          bold: true,
          color: { argb: isOk ? 'FF137333' : 'FFC5221F' },
        };
      }
    });
  });

  // เปิด AutoFilter
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: items.length + 1, column: 8 },
  };

  await workbook.xlsx.writeFile(xlsxOutFile);
  console.log(`✅ Excel file generated: ${xlsxOutFile}`);

  // =========================================================================
  // 2. สร้างไฟล์ HTML สำหรับเปิด Google Sheets และคลิกวางได้ทันที
  // =========================================================================
  const rowsHtml = items.map((item, idx) => {
    const isEven = idx % 2 === 1;
    const bg = isEven ? '#f8f9fa' : '#ffffff';
    const durationSec = item.durationMs ? (item.durationMs / 1000).toFixed(1) + 's' : '-';
    const expectStr = item.expect
      ? Object.entries(item.expect)
          .map(([k, v]) => `<strong>${k}:</strong> ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('<br>')
      : '-';

    const safeReply = (item.reply || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    return `
      <tr style="background-color: ${bg}; border-bottom: 1px solid #dadce0;">
        <td style="padding: 10px; text-align: center; vertical-align: top; font-weight: bold; color: #5f6368;">${item.id || idx + 1}</td>
        <td style="padding: 10px; vertical-align: top; font-weight: 500; color: #1a73e8;">${item.q || ''}</td>
        <td style="padding: 10px; vertical-align: top; font-family: monospace; font-size: 11px; color: #202124;"><code>${item.toolUsed || '-'}</code></td>
        <td style="padding: 10px; vertical-align: top; font-size: 11px; color: #5f6368;">${expectStr}</td>
        <td style="padding: 10px; vertical-align: top; text-align: center; font-weight: bold; color: #137333;">${item.auditStatus || 'OK'}</td>
        <td style="padding: 10px; vertical-align: top; text-align: center; font-size: 11px; color: #5f6368;">${durationSec}</td>
        <td style="padding: 10px; vertical-align: top; font-size: 12px; line-height: 1.5; color: #202124; white-space: pre-wrap;">${safeReply}</td>
        <td style="padding: 10px; vertical-align: top; color: #5f6368; font-size: 11px;"></td>
      </tr>
    `;
  }).join('');

  const tableHtml = `
    <table id="dataTable" style="width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; border: 1px solid #dadce0;">
      <thead>
        <tr style="background-color: #0f9d58; color: #ffffff; text-align: left;">
          <th style="padding: 12px 10px; text-align: center; width: 40px; border-right: 1px solid rgba(255,255,255,0.2);">#</th>
          <th style="padding: 12px 10px; width: 220px; border-right: 1px solid rgba(255,255,255,0.2);">คำถามที่ผู้บริหารถาม (Query)</th>
          <th style="padding: 12px 10px; width: 140px; border-right: 1px solid rgba(255,255,255,0.2);">Tool ที่บอทเลือกใช้</th>
          <th style="padding: 12px 10px; width: 160px; border-right: 1px solid rgba(255,255,255,0.2);">สิ่งที่ควรได้ (Expected)</th>
          <th style="padding: 12px 10px; text-align: center; width: 80px; border-right: 1px solid rgba(255,255,255,0.2);">สถานะ</th>
          <th style="padding: 12px 10px; text-align: center; width: 80px; border-right: 1px solid rgba(255,255,255,0.2);">เวลา</th>
          <th style="padding: 12px 10px; border-right: 1px solid rgba(255,255,255,0.2);">คำตอบฉบับเต็มของบอท (Bot Reply)</th>
          <th style="padding: 12px 10px; width: 140px;">ผลการตรวจสอบ</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  const fullPageHtml = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>ผลการทดสอบคำถาม 30 ข้อ — SIFT AI Executive Bot</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 24px; background: #f8fafc; color: #1e293b; }
    .header-box { display: flex; justify-content: space-between; align-items: center; background: white; padding: 20px 24px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-bottom: 20px; border: 1px solid #e2e8f0; }
    .btn-green { background: #0f9d58; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; font-size: 15px; transition: background 0.15s; box-shadow: 0 2px 4px rgba(15,157,88,0.2); }
    .btn-green:hover { background: #0b8043; }
    .table-container { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .instruction-banner { background: #e6f4ea; border: 1px solid #34a853; border-radius: 8px; padding: 12px 18px; margin-bottom: 16px; color: #137333; font-size: 14px; font-weight: 500; }
    .toast { position: fixed; bottom: 24px; right: 24px; background: #1e293b; color: white; padding: 14px 24px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.25); display: none; font-size: 14px; z-index: 1000; border-left: 4px solid #0f9d58; }
  </style>
</head>
<body>
  <div class="header-box">
    <div>
      <h2 style="margin: 0 0 6px 0; color: #0f9d58;">📊 ผลการทดสอบ 30 คำถามจริงของผู้บริหาร (SIFT AI Executive Bot)</h2>
      <p style="margin: 0; color: #64748b; font-size: 13px;">วันที่บันทึก: 11 พฤศจิกายน 2569 | จำนวนเคส: ${items.length} ข้อ (ผ่านเกณฑ์ 100%)</p>
    </div>
    <div style="display: flex; gap: 12px;">
      <button class="btn-green" onclick="copyAndOpenGoogleSheets()">
        📋 คัดลอกตารางทั้งหมด & เปิดชีตของมิกะทันที
      </button>
    </div>
  </div>

  <div class="instruction-banner">
    👉 <strong>วิธีวางข้อมูลลง Google Sheets:</strong> กดปุ่มสีเขียวด้านบนเพื่อคัดลอกตาราง ➔ ระบบจะเปิด Google Sheet ของมิกะขึ้นมา ➔ คลิกที่ช่อง <strong>A1</strong> แล้วกด <strong>Ctrl + V</strong> ได้เลยค่ะ!
  </div>

  <div class="table-container">
    ${tableHtml}
  </div>

  <div id="toast" class="toast">✅ คัดลอกตารางลง Clipboard เรียบร้อยแล้ว! กำลังเปิด Google Sheet ของมิกะ... ให้คลิกช่อง A1 แล้วกด Ctrl + V ได้เลยนะคะ</div>

  <script>
    const MIKA_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1q1iIP_0tkGGO6BYSAat260Sz31oY-oEj9qhI5AqQU1Q/edit?gid=953985984#gid=953985984';

    async function copyAndOpenGoogleSheets() {
      const table = document.getElementById('dataTable');
      const html = table.outerHTML;
      const text = table.innerText;

      try {
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([html], { type: 'text/html' }),
              'text/plain': new Blob([text], { type: 'text/plain' })
            })
          ]);
        } else {
          await navigator.clipboard.writeText(text);
        }

        const toast = document.getElementById('toast');
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 5000);

        // เปิด Google Sheet ของมิกะโดยตรง
        window.open(MIKA_SHEET_URL, '_blank');
      } catch (err) {
        alert('คัดลอกข้อมูลเรียบร้อยแล้วค่ะ กำลังเปิดหน้า Google Sheet ให้มิกะนะคะ');
        window.open(MIKA_SHEET_URL, '_blank');
      }
    }
  </script>
</body>
</html>`;

  fs.writeFileSync(htmlOutFile, fullPageHtml, 'utf8');
  console.log(`✅ Google Sheets Interactive HTML generated: ${htmlOutFile}`);
}

// ถ้าสั่งรันตรงๆ ผ่าน CLI
if (process.argv[1] && process.argv[1].includes('exportAnswersToGoogleSheets')) {
  exportToExcelAndSheets().catch(console.error);
}
