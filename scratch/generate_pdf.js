import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

async function generatePDF() {
  console.log('Starting Puppeteer PDF generation for Telegram plan...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="th">
  <head>
    <meta charset="UTF-8">
    <title>แผนงานพัฒนา AI Agent (Telegram) & MCP Integration</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
      body {
        font-family: 'Prompt', sans-serif;
        line-height: 1.6;
        color: #1e293b;
        padding: 40px;
        background-color: #ffffff;
      }
      .header {
        border-bottom: 3px solid #229ed9;
        padding-bottom: 15px;
        margin-bottom: 30px;
      }
      h1 {
        color: #0088cc;
        font-size: 24px;
        font-weight: 700;
        margin: 0 0 10px 0;
      }
      .subtitle {
        color: #64748b;
        font-size: 14px;
        font-weight: 400;
      }
      .badge {
        display: inline-block;
        background-color: #e0f2fe;
        color: #0369a1;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 9999px;
        margin-top: 5px;
      }
      h2 {
        color: #0f172a;
        font-size: 18px;
        border-left: 4px solid #0088cc;
        padding-left: 10px;
        margin-top: 25px;
        margin-bottom: 15px;
      }
      h3 {
        color: #334155;
        font-size: 15px;
        margin-top: 15px;
        margin-bottom: 8px;
      }
      p, li {
        font-size: 13px;
        color: #334155;
      }
      ul {
        padding-left: 20px;
        margin-top: 5px;
        margin-bottom: 15px;
      }
      li {
        margin-bottom: 6px;
      }
      .card {
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 20px;
      }
      .highlight-box {
        background-color: #f0f9ff;
        border: 1px solid #bae6fd;
        border-radius: 8px;
        padding: 12px;
        margin: 10px 0;
        font-weight: 600;
        color: #0369a1;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 15px;
        margin-bottom: 20px;
        font-size: 12px;
      }
      th, td {
        border: 1px solid #cbd5e1;
        padding: 10px;
        text-align: left;
      }
      th {
        background-color: #f1f5f9;
        color: #0f172a;
        font-weight: 600;
      }
      .footer {
        margin-top: 40px;
        padding-top: 15px;
        border-top: 1px solid #e2e8f0;
        text-align: center;
        font-size: 11px;
        color: #94a3b8;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <h1>แผนงานพัฒนา AI Agent ตอบคำถามผ่าน Telegram & เชื่อมต่อ MCP</h1>
      <div class="subtitle">ระบบคัดกรองและประเมินผล AI Triage (Telegram Bot Agent & Multi-MCP Integration)</div>
      <div class="badge">ปรับแก้ไข 1.3: ตอบคำถาม/รับคำสั่งผ่าน Telegram Bot แทนหน้า BO</div>
    </div>

    <div class="card">
      <h2 style="margin-top: 0;">📌 สรุปภาพรวมเป้าหมาย (Goal Overview)</h2>
      <p>ปรับการทำงานของระบบ AI ให้สามารถโต้ตอบคำถามและคำสั่งภาษาธรรมชาติผ่าน <b>Telegram Bot</b> เพื่อเชื่อมต่อและดึงข้อมูล <b>แชท (Chat Data), ยอดเงิน (Financial Balance), และการตลาด (Marketing Statistics)</b> ได้อย่างสะดวกรวดเร็ว และขยายการทำงานเชื่อมต่อกับโปรโตคอล MCP ภายนอกในอนาคต</p>
    </div>

    <h2>📌 Phase 1: พัฒนา AI Agent ตอบคำถาม/คำสั่งผ่าน Telegram (ข้อ 2 - เริ่มทำก่อน)</h2>
    <div class="card">
      <h3>1.1 ออกแบบสคีมาฐานข้อมูล (Database Schema)</h3>
      <ul>
        <li><b>ข้อมูลแชท (Chat Data)</b>: ตาราง <code>chats</code>, <code>chat_issues</code>, <code>categories</code> ใน Supabase</li>
        <li><b>ข้อมูลการเงิน (Financial Data)</b>: ตาราง <code>transactions</code> (ยอดฝาก/ถอน/โอน, สถานะ, timestamp)</li>
        <li><b>ข้อมูลการตลาด (Marketing Data)</b>: ตาราง <code>promotions</code> & <code>campaigns</code> (สถิติการใช้งานโบนัส/แคมเปญ)</li>
      </ul>

      <h3>1.2 พัฒนา AI Agent Controller & Function Calling Engine</h3>
      <ul>
        <li>โมเดลหลัก: <b>Qwen2.5:14b</b> ร่วมกับ Tool Calling / Function Calling</li>
        <li><code>query_chat_analytics</code>: สรุปสถิติแชท, ปัญหายอดฮิตประจำวัน/สัปดาห์</li>
        <li><code>query_financial_balance</code>: ตรวจสอบยอดเงินคงเหลือ และสรุปยอดฝาก-ถอน</li>
        <li><code>query_marketing_stats</code>: ตรวจสอบการใช้งานโปรโมชั่นและสิทธิ์โบนัสวันเกิด</li>
      </ul>

      <div class="highlight-box">
        🚀 1.3 พัฒนา Telegram Bot Integration & Webhook Service (ปรับแก้ไขตามคำขอคุณมิกะ)
      </div>
      <ul>
        <li><b>Telegram Bot API & Webhook</b>: พัฒนาตัวรับข้อความ Webhook โต้ตอบกับ Telegram Bot แบบ Real-time</li>
        <li><b>Security Whitelist</b>: ตรวจสอบสิทธิ์ Telegram Chat ID เฉพาะทีมงานที่ได้รับอนุญาตเพื่อความปลอดภัย</li>
        <li><b>Telegram Interactive Response</b>: สั่งงานใน Telegram ➔ AI ดึงข้อมูลและตอบกลับสรุปสถิติ/ตัวเลขเข้าห้องแชท Telegram ทันที</li>
      </ul>
    </div>

    <h2>📌 Phase 2: ทำให้ระบบ AI เชื่อมต่อกับ MCP ระบบอื่นๆ ได้ (ข้อ 1)</h2>
    <div class="card">
      <h3>2.1 พัฒนา MCP Client Architecture</h3>
      <ul>
        <li>สร้างโมดูล <b>MCP Client</b> ภายในระบบ AI Triage เพื่อทำหน้าที่ค้นหาและเชื่อมต่อไปยัง MCP Servers ภายนอก</li>
      </ul>

      <h3>2.2 เชื่อมต่อกับ MCP Server ภายนอก (External MCP Integration)</h3>
      <ul>
        <li><b>Payment Gateway MCP</b>: ตรวจสอบสถานะการโอนเงิน/สลิปธนาคารแบบ Real-time</li>
        <li><b>Marketing CRM MCP</b>: สั่งการส่งข้อความ/แจ้งเตือนหาลูกค้าแบบอัตโนมัติ</li>
        <li><b>Analytics MCP</b>: ดึงข้อมูลสถิติมุมมองภาพรวมองค์กร</li>
      </ul>
    </div>

    <h2>🧪 แผนการทดสอบความถูกต้อง (Verification Plan)</h2>
    <table>
      <thead>
        <tr>
          <th>หัวข้อการทดสอบ</th>
          <th>คำสั่งทดสอบพิมพ์ใน Telegram</th>
          <th>ผลลัพธ์ที่คาดหวังใน Telegram</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><b>1. ข้อมูลแชท</b></td>
          <td>"ช่วง 7 วันที่ผ่านมา ปัญหาอะไรที่ลูกค้าแจ้งเข้ามามากที่สุด?"</td>
          <td>AI เรียกใช้ <code>query_chat_analytics</code> และตอบสรุปสถิติใน Telegram</td>
        </tr>
        <tr>
          <td><b>2. ข้อมูลการเงิน</b></td>
          <td>"วันนี้มียอดฝากเงินรวมเท่าไหร่ และมียอดค้างปรับกี่รายการ?"</td>
          <td>AI เรียกใช้ <code>query_financial_balance</code> ตอบสรุปยอดฝากเข้า Telegram</td>
        </tr>
        <tr>
          <td><b>3. ข้อมูลการตลาด</b></td>
          <td>"โปรโมชั่นวันเกิดมีลูกค้าขอรับไปแล้วกี่คนในเดือนนี้?"</td>
          <td>AI เรียกใช้ <code>query_marketing_stats</code> ตอบจำนวนสิทธิ์ที่ใช้ไปใน Telegram</td>
        </tr>
        <tr>
          <td><b>4. เชื่อมต่อ MCP (Phase 2)</b></td>
          <td>"ตรวจสอบยอดสลิปธนาคารล่าสุดผ่าน Payment MCP"</td>
          <td>AI ส่ง MCP Call ไปยัง Payment MCP Server และส่งผลลัพธ์กลับมาใน Telegram</td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      เอกสารแผนงานจัดทำโดย Antigravity AI Assistant สำหรับคุณมิกะ | Telegram AI Agent & Multi-MCP Integration (2026)
    </div>
  </body>
  </html>
  `;

  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

  const pdfPath1 = path.join(process.cwd(), 'AI_Agent_Implementation_Plan.pdf');
  const pdfPath2 = 'C:\\Users\\USER\\.gemini\\antigravity\\brain\\02a73e8c-a208-483f-9533-792943e241a8\\AI_Agent_Implementation_Plan.pdf';

  await page.pdf({
    path: pdfPath1,
    format: 'A4',
    margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
    printBackground: true
  });

  fs.copyFileSync(pdfPath1, pdfPath2);

  await browser.close();
  console.log('Updated Telegram PDF generated successfully at:', pdfPath1);
  console.log('PDF copied to artifact path:', pdfPath2);
}

generatePDF().catch(err => {
  console.error('Error generating PDF:', err);
  process.exit(1);
});
