-- ==============================================================================
-- Seed the SOP knowledge base: every company gets its own copy of the same SOP set (one row per company per category)
--  - 9 SOPs that used to be hard-coded in the old agent code (source = legacy_code)
--  - 10 AI-drafted SOPs for categories that had none (source = ai_draft)
-- All rows are status = draft: the bot labels them "ร่าง (ยังไม่ได้ตรวจ)" until the team approves:
--   UPDATE knowledge_base SET status = 'approved', updated_at = now() WHERE category_key = '<key>';               -- all companies
--   UPDATE knowledge_base SET status = 'approved', updated_at = now() WHERE category_key = '<key>' AND company_id = '<uuid>';  -- one company
-- Safe to re-run: a company/category that already has a (non-archived) SOP is skipped.
-- Requires sql/p2_p3_verified_issues_and_knowledge_base.sql to be run first.
-- ==============================================================================

BEGIN;

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$page_load_freeze$sop$, $sop$คู่มือและแนวทางแก้ไขปัญหา: หน้าเว็บค้าง / โหลดช้า / จอขาว (Page Load & Freeze SOP)$sop$, $sop$🛠️ **แนวทางและขั้นตอนการแก้ไขปัญหา: หน้าเว็บค้าง / โหลดช้า / จอขาว (Page Load & Freeze SOP)**

👤 **1. การประสานงานและดูแลลูกค้าหน้างาน (Admin & Support SOP):**
- แนะนำลูกค้าทำการ Hard Reload: กด `Ctrl + F5` (คอมพิวเตอร์) หรือปิดเบราว์เซอร์แล้วเปิดใหม่ (มือถือ)
- แนะนำลูกค้าล้างแคชและคุกกี้ (Clear Cache & Cookies) ของเบราว์เซอร์ หรือทดลองเปิดในโหมดไม่ระบุตัวตน (Incognito Mode)
- แนะนำลูกค้าทดลองสลับสัญญาณอินเทอร์เน็ต (เช่น สลับจาก Wi-Fi เป็น 4G/5G) หรือเปลี่ยนเบราว์เซอร์ใช้งาน (เช่น สลับไปใช้ Google Chrome หรือ Safari)
- หากยังพบปัญหา ให้ขอภาพหน้าจอ (Screenshot), หน้า URL หรือเมนูที่ค้าง, รุ่นอุปกรณ์ และเบราว์เซอร์ เพื่อส่งต่อทีมเทคนิค

💻 **2. การตรวจสอบเชิงเทคนิคสำหรับทีมพัฒนาระบบ (Dev & DevOps SOP):**
- ตรวจสอบ Server Resources (CPU, Memory Usage, Connection Pool) บนเซิร์ฟเวอร์หลัก
- ตรวจสอบ CDN (Cloudflare / CloudFront) และการแคชไฟล์ Static Assets (JS, CSS, รูปภาพขนาดใหญ่)
- ตรวจสอบ Network Tab ใน Browser DevTools เพื่อดูว่ามี API เส้นใดหน่วง (High Latency) หรือเกิด Timeout
- ตรวจสอบ WebSocket / Real-time Connection ว่ามีการเชื่อมต่อค้างหรือ Reconnect วนซ้ำหรือไม่

📢 **3. แผนการสื่อสารและจัดการสถานการณ์:**
- หากมีลูกค้าแจ้งเข้ามาจำนวนมากพร้อมกัน ให้ประสานงานออกประกาศแจ้งสถานะบนหน้าเว็บทันที เพื่อแจ้งว่าทีมงานกำลังเร่งตรวจสอบและแก้ไขค่ะ$sop$, 'draft', 'legacy_code'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$page_load_freeze$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$access_blocked$sop$, $sop$คู่มือและแนวทางแก้ไขปัญหา: เข้าหน้าเว็บไม่ได้ / Error 502 / การเข้าถึงถูกระงับ (Access Blocked SOP)$sop$, $sop$🛠️ **แนวทางและขั้นตอนการแก้ไขปัญหา: เข้าหน้าเว็บไม่ได้ / Error 502 / ลิงก์เสีย (Access Blocked SOP)**

👤 **1. การดูแลลูกค้าหน้างาน (Support SOP):**
- ตรวจสอบว่าลูกค้าเข้าผ่านลิงก์ทางเข้าล่าสุดหรือไม่ หากเป็นลิงก์เก่าให้ส่งลิงก์ทางเข้าสำรอง (Backup Domain / Mirror)
- สอบถามว่าลูกค้าเปิด VPN หรือใช้เครือข่ายที่มีการบล็อกเนื้อหาหรือไม่
- แนะนำให้ลูกค้ารีเซ็ตสัญญาณอินเทอร์เน็ต หรือตั้งค่า Public DNS (1.1.1.1 หรือ 8.8.8.8)

💻 **2. การตรวจสอบฝั่ง Infrastructure & DevOps:**
- ตรวจสอบ Web Application Firewall (WAF) และ Cloudflare ว่ามีการบล็อก IP หรือส่ง CAPTCHA ซ้ำซ้อนหรือไม่
- ตรวจสอบ Reverse Proxy (Nginx) ว่า Forward Request ไปยัง Application Service ได้ปกติหรือไม่
- ตรวจสอบสถานะ Domain Name Server (DNS) และใบรับรองความปลอดภัย (SSL Certificate)$sop$, 'draft', 'legacy_code'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$access_blocked$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$login_issue$sop$, $sop$คู่มือและแนวทางแก้ไขปัญหา: ปัญหาระบบล็อกอิน / เข้าสู่ระบบ / OTP / ลืมรหัสผ่าน (Login Issue SOP)$sop$, $sop$🛠️ **แนวทางและขั้นตอนการแก้ไขปัญหา: ล็อกอินไม่ได้ / OTP / ลืมรหัสผ่าน (Login Issue SOP)**

👤 **1. การดูแลลูกค้าหน้างาน (Support SOP):**
- ตรวจสอบสถานะบัญชีลูกค้าในระบบหลังบ้านว่าถูกระงับชั่วคราวจากการใส่รหัสผิดเกินกำหนดหรือไม่
- หากลูกค้าลืมรหัสผ่าน ให้แนะนำใช้ฟังก์ชัน "ลืมรหัสผ่าน" เพื่อรับลิงก์รีเซ็ตผ่านเบอร์โทรหรืออีเมล
- กรณี OTP ไม่เข้า: ตรวจสอบเบอร์โทรศัพท์ของลูกค้า และแนะนำให้ลูกค้ารอ 1-2 นาทีแล้วกดขอรับรหัสใหม่

💻 **2. การตรวจสอบฝั่งระบบ (Dev & System):**
- ตรวจสอบสถานะและเครดิตของ SMS Gateway ผู้ให้บริการส่ง OTP
- ตรวจสอบ Session Storage และ Token Expiration Policy ในระบบ Authentication$sop$, 'draft', 'legacy_code'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$login_issue$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$deposit_withdrawal$sop$, $sop$คู่มือและแนวทางแก้ไขปัญหา: ปัญหาการเงิน / ฝากเงิน-ถอนเงินล่าช้า (Financial & Transactions SOP)$sop$, $sop$🛠️ **แนวทางและขั้นตอนการแก้ไขปัญหา: ฝาก-ถอนล่าช้า / เงินไม่เข้า (Financial Transactions SOP)**

👤 **1. การดูแลลูกค้าหน้างาน (Finance & Support SOP):**
- ขอหลักฐานสลิปการโอนเงินที่แสดงเลขที่รายการ วันที่ เวลา และยอดเงินอย่างชัดเจน
- ตรวจสอบรายการเดินบัญชี (Statement) ของธนาคารปลายทางว่ามียอดเงินเข้าจริงหรือไม่
- หากยอดเงินเข้าแล้วแต่ระบบออโต้ยังไม่ปรับ ให้เจ้าหน้าที่ฝ่ายการเงินดำเนินการปรับยอดแบบ Manual ทันที
- แจ้งกรอบเวลาการดำเนินการที่ชัดเจนให้ลูกค้าทราบ (เช่น ตรวจสอบเรียบร้อยภายใน 5-15 นาที)

💻 **2. การตรวจสอบระบบเชื่อมต่อ:**
- ตรวจสอบสถานะการเชื่อมต่อ API ของระบบ Auto-Bank และ Payment Gateway
- ตรวจสอบว่าธนาคารปลายทางมีประกาศปิดปรับปรุงระบบชั่วคราวหรือไม่$sop$, 'draft', 'legacy_code'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$deposit_withdrawal$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$ui_rendering_issue$sop$, $sop$คู่มือและแนวทางแก้ไขปัญหา: ปัญหากราฟิก / แสดงผลเพี้ยน / ตัวหนังสือซ้อน (UI Rendering Issue SOP)$sop$, $sop$🛠️ **แนวทางและขั้นตอนการแก้ไขปัญหา: หน้าเว็บแสดงผลเพี้ยน / ภาพไม่ขึ้น (UI Rendering SOP)**

👤 **1. คำแนะนำสำหรับลูกค้า:**
- แนะนำลูกค้าล้าง Browser Cache เพื่อโหลดไฟล์ CSS และ Layout เวอร์ชันล่าสุด
- แนะนำปิดส่วนขยายเบราว์เซอร์ (Extensions) ที่อาจรบกวนการแสดงผล เช่น AdBlocker หรือ Translation tool
- ตรวจสอบขนาดการซูมหน้าจอของเบราว์เซอร์ (Zoom Level) ให้อยู่ที่ 100%

💻 **2. การตรวจสอบฝั่ง Frontend Developer:**
- ตรวจสอบ Responsive CSS บนอุปกรณ์ต่างๆ โดยเฉพาะ Safari บน iOS และ Chrome บน Android
- เคลียร์ Cache บน Cloudflare / CDN หลังการ Deploy โค้ดเวอร์ชันใหม่$sop$, 'draft', 'legacy_code'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$ui_rendering_issue$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$interaction_lag$sop$, $sop$คู่มือและแนวทางแก้ไขปัญหา: ปัญหาปุ่มไม่ตอบสนอง / กดไม่ไป / ระบบหน่วง (Interaction Lag SOP)$sop$, $sop$🛠️ **แนวทางและขั้นตอนการแก้ไขปัญหา: ปุ่มกดไม่ตอบสนอง / ระบบหน่วง (Interaction Lag SOP)**

👤 **1. การดูแลลูกค้าหน้างาน:**
- แนะนำลูกค้าไม่กดย้ำปุ่มหลายครั้งติดต่อกันเพื่อป้องกันการส่งคำขอซ้ำซ้อน
- แนะนำลูกค้ารีเฟรชหน้าเว็บและรอระบบประมวลผลคำขอก่อนหน้า

💻 **2. การตรวจสอบฝั่ง Developer:**
- ตรวจสอบ Event Listener และปุ่มว่ามีสถานะ Disabled/Loading ค้างอยู่หรือไม่
- ตรวจสอบฟังก์ชัน Debounce / Throttle ของปุ่มกดทำรายการสำคัญ
- ตรวจสอบความเร็ว API Endpoints ที่ถูกเรียกใช้งานเมื่อกดปุ่ม$sop$, 'draft', 'legacy_code'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$interaction_lag$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$feedback_complaint$sop$, $sop$คู่มือและแนวทางแก้ไขปัญหา: ข้อร้องเรียนและการรับมือสถานการณ์ตึงเครียด (Customer Complaint SOP)$sop$, $sop$🛠️ **แนวทางและขั้นตอนการรับมือ: ข้อร้องเรียน / ลูกค้าอารมณ์ร้อน (Customer Escalation SOP)**

👤 **1. หลักการสื่อสารด้วยความเห็นอกเห็นใจ (Empathy First):**
- กล่าวขออภัยในความไม่สะดวกด้วยความสุภาพ จริงใจ และรับฟังปัญหาอย่างตั้งใจ
- ไม่โต้เถียงหรือใช้คำพูดปฏิเสธลูกค้า ใช้คำพูดแสดงความเข้าใจ เช่น "ทางเราเข้าใจความกังวลของลูกค้านะคะ จะเร่งดำเนินการตรวจสอบให้ทันทีค่ะ"
- แสดงความกระตือรือร้นในการช่วยแก้ปัญหาอย่างเป็นรูปธรรม

📌 **2. การส่งต่อเคสด่วน (Urgent Escalation):**
- ส่งต่อเคสที่มีความไม่พอใจสูงหรือมีความเสี่ยงให้หัวหน้างาน (Supervisor) ดูแลทันที
- แจ้งระยะเวลาการติดตามผลที่แน่นอน และอัปเดตความคืบหน้าให้ลูกค้าทราบเป็นระยะ$sop$, 'draft', 'legacy_code'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$feedback_complaint$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$api_error$sop$, $sop$คู่มือและแนวทางแก้ไขปัญหา: ข้อผิดพลาดระบบ API / เซิร์ฟเวอร์ขัดข้อง (API Error SOP)$sop$, $sop$🛠️ **แนวทางและขั้นตอนการแก้ไขปัญหา: ข้อผิดพลาดระบบ API (API Error SOP)**

💻 **1. การตรวจสอบและแก้ไขสำหรับทีม Dev / DevOps:**
- ตรวจสอบ API Server Error Logs (รหัส 500, 503, 504) ในระบบ Monitoring
- ตรวจสอบสถานะ Database Connection Pool ว่าเต็มหรือมี Slow Query ค้างอยู่หรือไม่
- ตรวจสอบโควตา Rate Limit หรือ Third-party API Dependencies
- ดำเนินการรีสตาร์ต Service หรือขยายขนาด Worker Instance ตามความเหมาะสม$sop$, 'draft', 'legacy_code'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$api_error$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, NULL, $sop$คู่มือและแนวทางมาตรฐานการรับมือและแก้ไขปัญหาของระบบ (Incident Management SOP)$sop$, $sop$🛠️ **แนวทางและขั้นตอนมาตรฐานการรับมือปัญหาของระบบ (Incident Management SOP)**

📌 **1. ขั้นตอนการคัดกรองปัญหาหน้างาน (Triage & Support):**
- สอบถามรายละเอียดปัญหาจากลูกค้าอย่างชัดเจน (หน้าที่เกิดปัญหา, ภาพหน้าจอ, เวลาที่เกิด)
- ระบุระดับความรวดเร็วและความสำคัญของปัญหา (ด่วนฉุกเฉิน / สูง / กลาง / ต่ำ)
- แก้ไขปัญหาเบื้องต้น เช่น การรีเฟรช ล้างแคช หรือเปลี่ยนเครือข่าย

📌 **2. ขั้นตอนการส่งต่อและประสานงาน (Escalation):**
- ส่งต่อเคสปัญหาทางเทคนิคไปยังทีม Developer พร้อมระบุรายละเอียดและตัวอย่างเคส
- หากเป็นปัญหาด้านการเงิน ส่งต่อไปยังทีม Finance พร้อมหลักฐานรายการเดินบัญชี

📌 **3. การติดตามผลและสื่อสาร (Post-resolution):**
- แจ้งผลการแก้ไขกลับไปยังลูกค้าทันทีเมื่อระบบกลับมาใช้งานได้ปกติ
- บันทึกสาเหตุของปัญหาเพื่อใช้วิเคราะห์และป้องกันไม่ให้เกิดซ้ำในอนาคตค่ะ$sop$, 'draft', 'legacy_code'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key IS NULL AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$promo_bonus$sop$, $sop$แนวทางแก้ไขปัญหา: โปรโมชั่นและโบนัส$sop$, $sop$🛠️ แนวทางแก้ไขปัญหา: โปรโมชั่นและโบนัส (ไม่ได้รับโบนัส / โค้ดใช้ไม่ได้ / เทิร์นโอเวอร์ผิด)

👤 1. การดูแลลูกค้าหน้างาน (Support)
- ขอข้อมูล: ชื่อโปรโมชั่นหรือโค้ด, วันเวลาที่กดรับ/ใช้งาน, ยอดรายการที่เกี่ยวข้อง และภาพหน้าจอข้อความที่ระบบแจ้ง
- ตรวจสอบเงื่อนไขโปรโมชั่นกับลูกค้า (ยอดขั้นต่ำ, ระยะเวลา, สิทธิ์ต่อบัญชี, เทิร์นโอเวอร์ที่ต้องทำ) และอธิบายให้ชัดเจน
- หากลูกค้าเข้าเงื่อนไขครบแต่ไม่ได้รับ ให้บันทึกเคสและส่งต่อทีมที่ดูแลโปรโมชั่น ห้ามเพิ่มเครดิตหรือโบนัสให้เอง

💻 2. สิ่งที่ทีมเทคนิคควรตรวจสอบ (Dev/Ops)
- ตรวจสอบการตั้งค่าโปรโมชั่น (ช่วงเวลา, กลุ่มลูกค้า, จำนวนสิทธิ์คงเหลือ) ว่าตรงกับที่ประกาศ
- ตรวจสอบ log การคำนวณโบนัส/เทิร์นโอเวอร์ของบัญชีที่แจ้ง ว่ามีรายการค้างหรือคำนวณผิด
- ตรวจสอบหน้าแสดงเงื่อนไขโปรโมชั่นว่าแสดงครบทุกอุปกรณ์

📢 3. การสื่อสารและการส่งต่อ
- หากพบปัญหาจากการตั้งค่าหรือระบบคำนวณ ให้แจ้งทีมการตลาดและทีมการเงินพร้อมรายชื่อบัญชีที่ได้รับผลกระทบ
- แจ้งลูกค้าระยะเวลาที่คาดว่าจะตรวจสอบเสร็จ และติดตามผลกลับทุกครั้ง$sop$, 'draft', 'ai_draft'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$promo_bonus$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$notification_issue$sop$, $sop$แนวทางแก้ไขปัญหา: การแจ้งเตือน (อีเมล / SMS / OTP)$sop$, $sop$🛠️ แนวทางแก้ไขปัญหา: ไม่ได้รับอีเมลยืนยัน / SMS / OTP / การแจ้งเตือน

👤 1. การดูแลลูกค้าหน้างาน (Support)
- ขอข้อมูล: อีเมลหรือเบอร์ที่ใช้, ประเภทข้อความที่รอ (ยืนยันสมัคร, รีเซ็ตรหัสผ่าน, OTP), เวลาที่กดขอ
- แนะนำให้ตรวจโฟลเดอร์ Spam/Junk/Promotions และตรวจว่ากรอกอีเมลหรือเบอร์ถูกต้อง
- แนะนำให้รอ 1-2 นาทีแล้วกดขอใหม่ ไม่กดซ้ำหลายครั้งติดกัน (อาจถูกจำกัดจำนวนครั้ง)
- หากยังไม่ได้รับ บันทึกเคสพร้อมเวลาที่ขอ แล้วส่งต่อทีมเทคนิค

💻 2. สิ่งที่ทีมเทคนิคควรตรวจสอบ (Dev/Ops)
- ตรวจสถานะผู้ให้บริการส่งอีเมล/SMS (โควต้า, ข้อผิดพลาดการส่ง, bounce rate) ในช่วงเวลาที่ลูกค้าแจ้ง
- ตรวจ log คิวการส่งข้อความว่ามีรายการค้างหรือล้มเหลวหรือไม่
- ตรวจการตั้งค่า SPF/DKIM/DMARC ของโดเมนผู้ส่ง หากอีเมลเข้า Spam บ่อย

📢 3. การสื่อสารและการส่งต่อ
- หากมีลูกค้าแจ้งพร้อมกันจำนวนมาก ให้ถือเป็นเหตุขัดข้องของระบบส่งข้อความและแจ้งสถานะบนหน้าเว็บ
- เสนอช่องทางยืนยันตัวตนสำรองตามนโยบายบริษัท (ถ้ามี) ระหว่างรอแก้ไข$sop$, 'draft', 'ai_draft'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$notification_issue$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$performance_issue$sop$, $sop$แนวทางแก้ไขปัญหา: ประสิทธิภาพระบบช้า$sop$, $sop$🛠️ แนวทางแก้ไขปัญหา: ระบบช้า / หน่วง / ประสิทธิภาพลดลง

👤 1. การดูแลลูกค้าหน้างาน (Support)
- ขอข้อมูล: หน้าหรือเมนูที่ช้า, ช่วงเวลาที่เกิด, อุปกรณ์และเครือข่ายที่ใช้
- แนะนำลองรีเฟรช สลับเครือข่าย (Wi-Fi/4G) หรือเปิดในเบราว์เซอร์อื่น เพื่อแยกว่าเป็นปัญหาฝั่งลูกค้าหรือระบบ
- หากหลายคนแจ้งพร้อมกัน ให้รวบรวมเวลาที่แจ้งส่งทีมเทคนิคทันที

💻 2. สิ่งที่ทีมเทคนิคควรตรวจสอบ (Dev/Ops)
- ตรวจ CPU / Memory / Connection pool ของเซิร์ฟเวอร์และฐานข้อมูลในช่วงเวลาที่ลูกค้าแจ้ง
- ตรวจ query หรือ API ที่ใช้เวลานาน (slow query, timeout) และ endpoint ที่มีปริมาณเรียกสูงผิดปกติ
- เทียบกับช่วงเวลาที่มีปัญหาบ่อยจากสถิติแชต เพื่อดูว่าตรงกับช่วงโหลดสูงหรืองาน batch หรือไม่

📢 3. การสื่อสารและการส่งต่อ
- หากเป็นวงกว้าง ประกาศสถานะระบบและเวลาที่คาดว่าจะกลับมาปกติ
- หลังแก้ไข ให้ติดตามว่าจำนวนแชตแจ้งระบบช้าลดลงจริง$sop$, 'draft', 'ai_draft'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$performance_issue$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$feature_request$sop$, $sop$แนวทางจัดการ: คำขอเพิ่มฟีเจอร์$sop$, $sop$🛠️ แนวทางจัดการ: ลูกค้าขอเพิ่มฟีเจอร์ / ขอปรับปรุงระบบ

👤 1. การดูแลลูกค้าหน้างาน (Support)
- ขอบคุณลูกค้าสำหรับข้อเสนอแนะ และสอบถามสั้นๆ ว่าต้องการใช้ฟีเจอร์นี้เพื่อแก้ปัญหาอะไร
- ไม่รับปากวันเวลาหรือยืนยันว่าจะทำแน่นอน ให้แจ้งว่าจะส่งต่อทีมพัฒนาพิจารณา
- บันทึกคำขอพร้อมตัวอย่างการใช้งานที่ลูกค้าเล่า

💻 2. สิ่งที่ทีมพัฒนา/Product ควรทำ
- รวบรวมคำขอที่คล้ายกันและนับจำนวนลูกค้าที่ขอ เพื่อจัดลำดับความสำคัญ
- ตรวจว่ามีฟีเจอร์เดิมที่ตอบโจทย์อยู่แล้วแต่ลูกค้าหาไม่เจอหรือไม่ (อาจแก้ด้วยการปรับหน้าจอหรือคู่มือ)

📢 3. การสื่อสารและการส่งต่อ
- สรุปคำขอยอดนิยมให้ผู้บริหารเป็นรอบ (เช่น รายเดือน)
- เมื่อฟีเจอร์ถูกพัฒนาแล้ว แจ้งกลับลูกค้าที่เคยขอ$sop$, 'draft', 'ai_draft'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$feature_request$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$vip_privilege$sop$, $sop$แนวทางแก้ไขปัญหา: สิทธิประโยชน์ระดับ VIP$sop$, $sop$🛠️ แนวทางแก้ไขปัญหา: สิทธิ์ VIP ไม่ถูกต้อง / ระดับไม่อัปเดต / ไม่ได้รับสิทธิพิเศษ

👤 1. การดูแลลูกค้าหน้างาน (Support)
- ขอข้อมูล: ระดับที่ลูกค้าคาดว่าควรได้, ระดับที่ระบบแสดง, สิทธิ์ที่ยังไม่ได้รับ และวันที่ครบเกณฑ์
- อธิบายเกณฑ์การเลื่อนระดับและรอบเวลาการอัปเดตระดับตามนโยบาย
- หากลูกค้าครบเกณฑ์แต่ระดับไม่อัปเดต ให้บันทึกเคสส่งทีมที่ดูแล VIP ห้ามปรับระดับหรือให้สิทธิ์เอง

💻 2. สิ่งที่ทีมเทคนิคควรตรวจสอบ (Dev/Ops)
- ตรวจงานคำนวณระดับสมาชิก (รอบการทำงาน, รายการที่ค้าง) และยอดสะสมของบัญชีที่แจ้ง
- ตรวจการผูกสิทธิ์ของแต่ละระดับว่าตั้งค่าครบ

📢 3. การสื่อสารและการส่งต่อ
- เคส VIP ควรได้รับการติดตามเร็วกว่าเคสทั่วไป และแจ้งผลกลับลูกค้าโดยตรง$sop$, 'draft', 'ai_draft'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$vip_privilege$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$registration$sop$, $sop$แนวทางแก้ไขปัญหา: การสมัครสมาชิก$sop$, $sop$🛠️ แนวทางแก้ไขปัญหา: สมัครสมาชิกไม่ได้ / อีเมลหรือเบอร์ถูกใช้แล้ว / ยืนยันตัวตนไม่ได้

👤 1. การดูแลลูกค้าหน้างาน (Support)
- ขอข้อมูล: ขั้นตอนที่ติด, ข้อความ error ที่ขึ้น (ภาพหน้าจอ), อุปกรณ์/เบราว์เซอร์ และเวลาที่ลองสมัคร
- หากขึ้นว่าอีเมลหรือเบอร์ถูกใช้แล้ว ให้ตรวจว่าลูกค้าเคยสมัครไว้หรือไม่ และแนะนำการกู้รหัสผ่านแทนการสมัครใหม่
- หากติดที่การยืนยันอีเมล/SMS ให้ทำตามแนวทางของหมวดปัญหาการแจ้งเตือน
- ห้ามสร้างหรือแก้ไขบัญชีแทนลูกค้าโดยไม่ยืนยันตัวตนตามนโยบาย

💻 2. สิ่งที่ทีมเทคนิคควรตรวจสอบ (Dev/Ops)
- ตรวจ log ของ API สมัครสมาชิกในช่วงเวลาที่ลูกค้าแจ้ง (validation error, timeout, ข้อมูลซ้ำ)
- ตรวจว่ากรณีสมัครไม่สำเร็จแต่ระบบบันทึกข้อมูลไปบางส่วน จนลูกค้าสมัครซ้ำไม่ได้หรือไม่
- ตรวจข้อความ error ว่าบอกลูกค้าชัดเจนว่าต้องทำอะไรต่อ

📢 3. การสื่อสารและการส่งต่อ
- ปัญหาสมัครไม่ได้กระทบลูกค้าใหม่โดยตรง หากพบหลายเคสในช่วงเดียวกันให้ยกระดับเป็นเหตุเร่งด่วน$sop$, 'draft', 'ai_draft'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$registration$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$game_issue$sop$, $sop$แนวทางแก้ไขปัญหา: ปัญหาเกี่ยวกับตัวเกม$sop$, $sop$🛠️ แนวทางแก้ไขปัญหา: เกมค้าง / หลุดกลางคัน / โหลดเกมไม่ได้

👤 1. การดูแลลูกค้าหน้างาน (Support)
- ขอข้อมูล: ชื่อเกม, เวลาที่เกิด, ยอดหรือรายการที่กำลังเล่นค้างอยู่ (ถ้ามี), อุปกรณ์และเครือข่าย
- แนะนำออกจากเกมแล้วเข้าใหม่ หรือสลับเครือข่าย เพื่อแยกว่าเป็นปัญหาฝั่งลูกค้าหรือไม่
- หากมีรายการหรือยอดค้างจากการหลุดกลางคัน ให้บันทึกเคสส่งทีมที่รับผิดชอบตรวจสอบ ห้ามปรับยอดให้เอง

💻 2. สิ่งที่ทีมเทคนิคควรตรวจสอบ (Dev/Ops)
- ตรวจสถานะการเชื่อมต่อกับผู้ให้บริการเกม (API timeout, error rate) ในช่วงเวลาที่แจ้ง
- ตรวจ log ของรอบเกมที่ลูกค้าแจ้ง ว่ามีผลลัพธ์บันทึกครบหรือค้าง

📢 3. การสื่อสารและการส่งต่อ
- หากเป็นปัญหาจากผู้ให้บริการเกม ให้ติดต่อผู้ให้บริการและแจ้งสถานะกับลูกค้า
- หากกระทบหลายเกมพร้อมกัน ประกาศสถานะบนหน้าเว็บ$sop$, 'draft', 'ai_draft'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$game_issue$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$device_compatibility$sop$, $sop$แนวทางแก้ไขปัญหา: บราวเซอร์ / อุปกรณ์$sop$, $sop$🛠️ แนวทางแก้ไขปัญหา: ใช้งานบนมือถือ/แท็บเล็ตไม่ได้ / บางเบราว์เซอร์แสดงผลผิด

👤 1. การดูแลลูกค้าหน้างาน (Support)
- ขอข้อมูล: รุ่นอุปกรณ์, ระบบปฏิบัติการ, เบราว์เซอร์และเวอร์ชัน, หน้าที่มีปัญหา และภาพหน้าจอ
- แนะนำอัปเดตเบราว์เซอร์ หรือลองเบราว์เซอร์อื่นชั่วคราว (เช่น Chrome หรือ Safari) เพื่อใช้งานต่อได้
- บันทึกว่าปัญหาเกิดเฉพาะอุปกรณ์/เบราว์เซอร์ใด เพื่อให้ทีมเทคนิคจำลองปัญหาได้

💻 2. สิ่งที่ทีมเทคนิคควรตรวจสอบ (Dev/Ops)
- ทดสอบหน้าที่ลูกค้าแจ้งบนอุปกรณ์/เบราว์เซอร์เดียวกัน (responsive layout, ฟีเจอร์ที่เบราว์เซอร์ไม่รองรับ)
- ตรวจ error ฝั่งหน้าเว็บ (console error) ที่เกิดเฉพาะเบราว์เซอร์นั้น

📢 3. การสื่อสารและการส่งต่อ
- หากยังแก้ไม่ได้ทันที แจ้งลูกค้าว่าเบราว์เซอร์/อุปกรณ์ใดใช้งานได้ระหว่างรอแก้ไข$sop$, 'draft', 'ai_draft'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$device_compatibility$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$payment_gateway$sop$, $sop$แนวทางแก้ไขปัญหา: ระบบการชำระเงิน / ธนาคาร$sop$, $sop$🛠️ แนวทางแก้ไขปัญหา: ชำระเงินไม่สำเร็จ / QR Code / PromptPay ขัดข้อง / หมดเวลาทำรายการ

👤 1. การดูแลลูกค้าหน้างาน (Support)
- ขอข้อมูล: ช่องทางที่ชำระ, ยอดเงิน, วันเวลา, หมายเลขอ้างอิงรายการหรือสลิป และข้อความ error ที่ขึ้น
- ถามลูกค้าว่าเงินถูกตัดจากบัญชีแล้วหรือไม่ หากถูกตัดแล้ว ให้แจ้งลูกค้าว่ากำลังตรวจสอบและห้ามให้ลูกค้าชำระซ้ำ
- ห้ามยืนยันยอดเงิน คืนเงิน หรือปรับยอดให้เอง ให้ส่งต่อทีมการเงินพร้อมข้อมูลครบ

💻 2. สิ่งที่ทีมเทคนิคควรตรวจสอบ (Dev/Ops)
- ตรวจสถานะผู้ให้บริการชำระเงิน/ธนาคาร (error rate, timeout) ในช่วงเวลาที่แจ้ง
- ตรวจรายการที่ชำระสำเร็จฝั่งผู้ให้บริการแต่ระบบยังไม่อัปเดต (callback/webhook ล้มเหลว)
- ตรวจเวลาหมดอายุของ QR Code ว่าสั้นเกินไปหรือไม่

📢 3. การสื่อสารและการส่งต่อ
- ปัญหาการชำระเงินกระทบรายได้โดยตรง หากพบหลายเคสในช่วงเดียวกันให้แจ้งทีมการเงินและผู้บริหารทันที
- แจ้งลูกค้าระยะเวลาตรวจสอบและติดตามผลกลับทุกเคส$sop$, 'draft', 'ai_draft'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$payment_gateway$sop$ AND k.status <> 'archived'
);

INSERT INTO knowledge_base (company_id, category_key, title, content, status, source)
SELECT c.id, $sop$account_security$sop$, $sop$แนวทางแก้ไขปัญหา: ความปลอดภัยของบัญชี$sop$, $sop$🛠️ แนวทางแก้ไขปัญหา: สงสัยบัญชีถูกเข้าใช้ / ข้อมูลถูกเปลี่ยนโดยไม่ได้ทำเอง / ขอเปลี่ยนบัญชีธนาคารหรือเบอร์โทร

👤 1. การดูแลลูกค้าหน้างาน (Support)
- ถือเป็นเคสเร่งด่วน: ยืนยันตัวตนลูกค้าตามนโยบายก่อนดำเนินการใดๆ
- หากสงสัยว่าบัญชีถูกเข้าใช้ แนะนำให้เปลี่ยนรหัสผ่านทันทีและออกจากระบบทุกอุปกรณ์ (ถ้าระบบรองรับ)
- คำขอเปลี่ยนบัญชีธนาคารหรือเบอร์โทร ต้องผ่านขั้นตอนยืนยันตัวตนเต็มรูปแบบ ห้ามเปลี่ยนให้จากการแจ้งทางแชตอย่างเดียว
- บันทึกเคสพร้อมเวลาที่ลูกค้าพบความผิดปกติ แล้วส่งต่อทีมความปลอดภัยทันที

💻 2. สิ่งที่ทีมเทคนิคควรตรวจสอบ (Dev/Ops)
- ตรวจประวัติการเข้าสู่ระบบ (IP, อุปกรณ์, เวลา) และการเปลี่ยนแปลงข้อมูลบัญชีที่ลูกค้าแจ้ง
- พิจารณาระงับการทำรายการสำคัญของบัญชีชั่วคราวระหว่างตรวจสอบตามนโยบาย
- ตรวจว่ามีบัญชีอื่นถูกเข้าใช้ในลักษณะเดียวกันหรือไม่

📢 3. การสื่อสารและการส่งต่อ
- แจ้งผู้บริหารหากพบหลายบัญชีถูกเข้าใช้ในช่วงเดียวกัน (อาจเป็นเหตุด้านความปลอดภัยวงกว้าง)
- แจ้งผลการตรวจสอบกลับลูกค้าโดยตรง$sop$, 'draft', 'ai_draft'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM knowledge_base k
  WHERE k.company_id = c.id AND k.category_key = $sop$account_security$sop$ AND k.status <> 'archived'
);

COMMIT;
