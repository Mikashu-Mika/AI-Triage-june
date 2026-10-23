import dotenv from 'dotenv';
import { supabase } from '../src/supabase.js';

dotenv.config();

const COMPANY_ID = '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2';

const multiIssueChats = [
  {
    id: 'chat-multi-001',
    customer_id: 'cust-001',
    company_id: COMPANY_ID,
    conversation: 'ลูกค้า: สวัสดีครับแอดมิน พอดีผมทำรายการสแกนจ่ายเงินผ่าน QR PromptPay ยอด 1,200 บาท แต่ระบบตัดเงินจากบัญชีธนาคารไป 2 รอบ กลายเป็นตัดไป 2,400 บาทครับ\nพนักงาน: สวัสดีครับคุณสมชาย ขออภัยในความไม่สะดวกด้วยครับ รบกวนขอภาพสลิปการโอนเงินทั้งสองรายการเพื่อตรวจสอบกับเกตเวย์ให้ครับ\nลูกค้า: ผมพยายามจะกดแนบไฟล์รูปสลิปในหน้าแชตแล้วครับ แต่พอกดปุ่ม "แนบรูปสลิป" แล้วปุ่มมันกลายเป็นสีเทาหมุนค้าง คลิกอะไรต่อไม่ได้เลยครับ\nลูกค้า: แถมปกติเวลาชำระเงินสำเร็จจะมีอีเมลยืนยันออเดอร์ส่งมาทันที แต่วันนี้ไม่มีอีเมลแจ้งเตือนเข้ามาเลยสักฉบับครับ ไม่แน่ใจว่าระบบบันทึกรายการคำสั่งซื้อไปหรือยัง\nพนักงาน: ได้รับเรื่องทั้ง 3 ส่วนแล้วครับ เบื้องต้นเจ้าหน้าที่ฝ่ายการเงินกำลังดึงสเตทเม้นท์ตรวจสอบยอดเงินที่ถูกตัดซ้ำ และทีมเทคนิคกำลังรีเซ็ตช่องทางอัปโหลดไฟล์ให้ครับ สำหรับอีเมลทางระบบจะส่งใบเสร็จย้อนหลังให้ทันทีเมื่อปรับยอดเรียบร้อยครับ',
    status: 'pending',
    priority: 'high',
    category_id: 'payment_gateway',
    sub_category: 'QR PromptPay Double Charge & Upload Lag',
    intent: 'แจ้งยอดเงินตัดซ้ำ แนบสลิปค้าง และไม่ได้รับอีเมลยืนยัน',
    root_cause: 'เกตเวย์ประมวลผลซ้ำซ้อน ร่วมกับปัญหาปุ่มแนบไฟล์บนหน้าเว็บเกิดอาการหน่วง',
    sentiment: 'negative',
    urgency: 'high',
    department: 'Finance & Technical Support',
    keywords: ['QR PromptPay', 'ตัดเงินซ้ำ', 'ปุ่มแนบรูปค้าง', 'ไม่มีอีเมลยืนยัน'],
    summary: 'ลูกค้าแจ้งปัญหา 3 เรื่องพร้อมกัน: 1) สแกนจ่าย QR PromptPay ถูกตัดเงินซ้ำ 2 รอบ 2) ปุ่มแนบสลิปหมุนค้างไม่ตอบสนอง 3) ไม่ได้รับอีเมลยืนยันคำสั่งซื้อ เจ้าหน้าที่ประสานงานตรวจสอบยอดและแก้ไขให้อย่างเร่งด่วน',
    recommended_reply: 'ทางฝ่ายการเงินกำลังตรวจสอบยอดเงินที่ตัดซ้ำและจะทำเรื่องคืนเงินให้ภายใน 10 นาทีค่ะ พร้อมทั้งประสานงานฝ่ายเทคนิคตรวจสอบระบบอัปโหลดและส่งใบเสร็จให้ทางอีเมลนะคะ',
    detected_issues: [
      { issue_no: 1, problem_summary: 'สแกน QR PromptPay ยอดตัดซ้ำ 2 รอบ', category_id: 'payment_gateway', urgency: 'high', department: 'Finance' },
      { issue_no: 2, problem_summary: 'ปุ่มแนบไฟล์รูปสลิปกลายเป็นสีเทาหมุนค้าง', category_id: 'interaction_lag', urgency: 'medium', department: 'Technical Support' },
      { issue_no: 3, problem_summary: 'ไม่ได้รับอีเมลยืนยันคำสั่งซื้อ', category_id: 'notification_issue', urgency: 'medium', department: 'Customer Service' }
    ]
  },
  {
    id: 'chat-multi-002',
    customer_id: 'cust-002',
    company_id: COMPANY_ID,
    conversation: 'ลูกค้า: สวัสดีค่ะแอดมิน พอดีเปิดใช้งานเว็บไซต์ผ่าน Safari บน iPhone 15 ค่ะ พยายามจะกดสมัครสมาชิกใหม่ แต่พอกรอกเบอร์โทรศัพท์ ระบบดันแจ้งเตือนว่า "เบอร์โทรศัพท์นี้มีในระบบแล้ว" ทั้งที่ไม่เคยสมัครมาก่อนเลยค่ะ\nพนักงาน: สวัสดีค่ะคุณสมศรี รบกวนแจ้งเบอร์โทรศัพท์เพื่อให้แอดมินตรวจสอบสถานะในฐานข้อมูลให้นะคะ\nลูกค้า: เบอร์ 0823456789 ค่ะ พอลองเปลี่ยนมากด "ลืมรหัสผ่าน" เผื่อเคยมีบัญชีเดิม ระบบบอกว่าส่งรหัส OTP ไปแล้ว แต่รอมา 20 นาทีแล้วไม่มีข้อความ SMS ส่งเข้ามาที่มือถือเลยสักข้อความค่ะ\nลูกค้า: อีกเรื่องคือหน้าจอ Safari บนมือถือเวลากดปุ่มย้อนกลับ เมนูและปุ่มกดยืนยันมันเลื่อนหลุดจมหายไปใต้แถบด้านล่าง กดอะไรยากมากเลยค่ะ\nพนักงาน: ตรวจสอบพบว่าเบอร์นี้มีการบันทึกค้างไว้จากระบบเก่าค่ะ แอดมินได้ทำการเคลียร์เบอร์ให้แล้ว และส่งลิงก์ตั้งรหัสผ่านตรงเข้าอีเมลให้เรียบร้อยแล้วค่ะ ส่วนเรื่องการแสดงผลบน Safari แอดมินส่งภาพหน้าจอให้ทีมดีไซน์แก้ไข Responsive CSS แล้วนะคะ',
    status: 'pending',
    priority: 'high',
    category_id: 'registration',
    sub_category: 'Duplicate Phone & SMS OTP Delivery & Safari Layout Bug',
    intent: 'สมัครสมาชิกไม่ได้เบอร์ซ้ำ ขอ OTP ไม่ส่ง และ UI Safari เพี้ยน',
    root_cause: 'ข้อมูลเบอร์โทรตกค้างในระบบเดิม ร่วมกับเกตเวย์ SMS ขัดข้อง และ CSS Viewport บน Safari ผิดพลาด',
    sentiment: 'frustrated',
    urgency: 'high',
    department: 'Customer Support & Front-end Team',
    keywords: ['สมัครไม่ได้', 'เบอร์ซ้ำ', 'OTP SMS ไม่เข้า', 'Safari บน iPhone', 'ปุ่มจมหาย'],
    summary: 'ลูกค้าพบปัญหา 3 จุด: 1) สมัครสมาชิกไม่ได้เนื่องจากระบบแจ้งเบอร์ซ้ำ 2) รหัส OTP SMS ไม่ส่งมายังมือถือ 3) การแสดงผลบน Safari บน iPhone เมนูและปุ่มจมหายไปใต้จอ แอดมินเคลียร์เบอร์และส่งลิงก์เข้าอีเมลแทน',
    recommended_reply: 'แอดมินได้ทำการเคลียร์เบอร์โทรศัพท์ที่ค้างในระบบให้แล้วนะคะ พร้อมส่งลิงก์ตั้งรหัสผ่านเข้าอีเมล และส่งเรื่องให้ทีมพัฒนาปรับปรุงหน้าจอ Safari แล้วค่ะ',
    detected_issues: [
      { issue_no: 1, problem_summary: 'สมัครสมาชิกไม่ได้ แจ้งว่าเบอร์โทรศัพท์มีในระบบแล้ว', category_id: 'registration', urgency: 'high', department: 'Customer Support' },
      { issue_no: 2, problem_summary: 'ขอรหัส OTP แต่ไม่มีข้อความ SMS ส่งมา', category_id: 'login_issue', urgency: 'high', department: 'Technical Support' },
      { issue_no: 3, problem_summary: 'เมนูและปุ่มบน Safari iPhone จมหายไปใต้ขอบจอ', category_id: 'device_compatibility', urgency: 'low', department: 'Front-end Team' }
    ]
  },
  {
    id: 'chat-multi-003',
    customer_id: 'cust-003',
    company_id: COMPANY_ID,
    conversation: 'ลูกค้า: แอดมินครับ ช่วยตามเรื่องการถอนเงินหน่อยครับ ผมกดถอนเงินจากกระเป๋าวอลเล็ตเข้าบัญชีไทยพาณิชย์ไป 3,500 บาท ตั้งแต่ 9 โมงเช้า ตอนนี้ 2 ชั่วโมงแล้ว ยอดเงินยังไม่เข้าบัญชีเลยครับ\nพนักงาน: สวัสดีครับคุณอนันต์ ขออภัยในความล่าช้าอย่างยิ่งครับ รบกวนขอเลขที่คำขอถอนเงินด้วยครับ\nลูกค้า: ผมจะเข้าไปดูเลขที่คำขอในหน้าประวัติธุรกรรม แต่พอกดเข้าไปแล้วหน้าเว็บมันหมุนค้างเป็นจอดำไปเลยครับ โหลดไม่ขึ้นสักที รีเฟรชก็ยังค้างเหมือนเดิม\nลูกค้า: แล้วผมขอร้องเรียนเรื่องการบริการหน่อยครับ ทักแชตเข้ามาตั้งแต่ 10 โมงกว่าจะมีคนตอบรอนานเกือบ 40 นาที การบริการช้ามากครับ อยากให้ปรับปรุงระบบคิวแชตด่วนเลยครับ\nพนักงาน: น้อมรับข้อร้องเรียนเรื่องการตอบกลับล่าช้าครับ ทางเราจะนำไปปรับปรุงระบบคิวพนักงานทันทีครับ ส่วนยอดถอนเงิน 3,500 บาท เจ้าหน้าที่ฝ่ายการเงินกำลังดึงข้อมูลและจะโอนยอดเข้าบัญชีธนาคารให้ภายใน 15 นาทีนี้ครับ',
    status: 'pending',
    priority: 'high',
    category_id: 'deposit_withdrawal',
    sub_category: 'Delayed Withdrawal & Page Freeze & Service Complaint',
    intent: 'ถอนเงินล่าช้า หน้าประวัติค้างจอดำ และร้องเรียนการบริการตอบช้า',
    root_cause: 'คิวการโอนเงินของฝ่ายการเงินติดขัด และมีบั๊กในหน้าประวัติธุรกรรมที่ทำให้หน้าจอดำ',
    sentiment: 'angry',
    urgency: 'high',
    department: 'Finance & Customer Experience',
    keywords: ['ถอนเงินไม่เข้า', '3500 บาท', 'หน้าประวัติจอดำ', 'ร้องเรียน', 'ตอบช้า 40 นาที'],
    summary: 'ลูกค้ากดถอนเงิน 3,500 บาทแล้วเงินไม่เข้า หน้าประวัติธุรกรรมหมุนค้างจอดำ และร้องเรียนว่าแอดมินตอบช้าเกือบ 40 นาที แอดมินเร่งตรวจสอบและยืนยันโอนยอดให้ใน 15 นาที',
    recommended_reply: 'กราบขออภัยในความล่าช้าทั้งเรื่องการตอบกลับและการทำรายการถอนเงินค่ะ ขณะนี้ฝ่ายการเงินได้ดำเนินการโอนยอด 3,500 บาทเข้าบัญชีให้เรียบร้อยแล้วนะคะ',
    detected_issues: [
      { issue_no: 1, problem_summary: 'ถอนเงิน 3,500 บาท 2 ชั่วโมงแล้วเงินยังไม่เข้าบัญชี', category_id: 'deposit_withdrawal', urgency: 'high', department: 'Finance' },
      { issue_no: 2, problem_summary: 'หน้าประวัติธุรกรรมหมุนค้างเป็นจอดำ โหลดไม่ขึ้น', category_id: 'page_load_freeze', urgency: 'medium', department: 'Technical Support' },
      { issue_no: 3, problem_summary: 'ร้องเรียนแอดมินตอบแชตช้าเกิน 40 นาที ขอให้ปรับปรุงคิวบริการ', category_id: 'feedback_complaint', urgency: 'medium', department: 'Customer Experience' }
    ]
  },
  {
    id: 'chat-multi-004',
    customer_id: 'cust-004',
    company_id: COMPANY_ID,
    conversation: 'ลูกค้า: สวัสดีครับ พอดีได้รับแจ้งเตือนว่ามีการเข้าสู่ระบบบัญชีของผมจากอุปกรณ์แปลกปลอมในจังหวัดเชียงใหม่ ทั้งที่ผมอยู่กรุงเทพฯ ครับ สงสัยว่าบัญชีกำลังถูกแฮก\nพนักงาน: สวัสดีครับคุณณัฐพงษ์ เพื่อความปลอดภัย แนะนำให้ทำรายการเปลี่ยนรหัสผ่านทันที และกดปุ่มออกจากระบบทุกอุปกรณ์ครับ\nลูกค้า: ผมพยายามจะกดเปลี่ยนรหัสผ่านในหน้าตั้งค่าแล้วครับ แต่พอกดปุ่ม "บันทึกรหัสผ่านใหม่" ระบบมันฟ้องว่า "Session Expired กรุณาเข้าสู่ระบบใหม่" แล้วเด้งหลุดออกมาหน้าล็อกอินทันทีเลยครับ\nลูกค้า: แถมอีเมลแจ้งเตือนความปลอดภัยเพิ่งส่งเข้ามาเมื่อ 5 นาทีที่แล้ว ทั้งที่ในระบบบอกว่ามีการล็อกอินตั้งแต่ช่วงเช้า ระบบแจ้งเตือนดีเลย์เป็นชั่วโมงเลยครับ\nพนักงาน: เพื่อความปลอดภัยสูงสุด เจ้าหน้าที่ได้ทำการระงับการเข้าถึงของอุปกรณ์แปลกปลอมและเตะทุก Session ออกแล้วครับ พร้อมทั้งส่งลิงก์รีเซ็ตรหัสผ่านแบบใช้ครั้งเดียว (One-Time Token) ที่ปลอดภัยให้ทาง SMS เบอร์มือถือของคุณลูกค้าเรียบร้อยแล้วครับ',
    status: 'pending',
    priority: 'high',
    category_id: 'account_security',
    sub_category: 'Account Breach Alert & Session Kick & Notification Delay',
    intent: 'แจ้งบัญชีถูกเข้าถึงโดยไม่ได้รับอนุญาต เปลี่ยนรหัสแล้วหลุด และอีเมลเตือนช้า',
    root_cause: 'Session Conflict ระหว่างอุปกรณ์แปลกปลอมกับผู้ใช้จริง และระบบคิวส่งเมลแจ้งเตือนล่าช้า',
    sentiment: 'anxious',
    urgency: 'high',
    department: 'Cyber Security & Technical Support',
    keywords: ['บัญชีถูกแฮก', 'อุปกรณ์แปลกปลอม', 'Session Expired', 'แจ้งเตือนดีเลย์'],
    summary: 'ลูกค้าสงสัยว่าบัญชีถูกเข้าถึงจากอุปกรณ์อื่น พยายามเปลี่ยนรหัสผ่านแต่ระบบแจ้ง Session Expired และเด้งหลุด รวมถึงอีเมลแจ้งเตือนความปลอดภัยดีเลย์ เจ้าหน้าที่ระงับการเข้าถึงและส่งลิงก์รีเซ็ตให้ทาง SMS ทันที',
    recommended_reply: 'เจ้าหน้าที่ได้ระงับการเข้าถึงจากอุปกรณ์แปลกปลอมทั้งหมดแล้วนะคะ และได้ส่งลิงก์รีเซ็ตรหัสผ่านที่มีความปลอดภัยสูงไปทาง SMS ให้เรียบร้อยแล้วค่ะ',
    detected_issues: [
      { issue_no: 1, problem_summary: 'มีแจ้งเตือนการล็อกอินจากอุปกรณ์แปลกปลอม บัญชีเสี่ยงถูกแฮก', category_id: 'account_security', urgency: 'high', department: 'Cyber Security' },
      { issue_no: 2, problem_summary: 'กดบันทึกรหัสผ่านใหม่แล้วระบบฟ้อง Session Expired และเด้งหลุด', category_id: 'login_issue', urgency: 'high', department: 'Technical Support' },
      { issue_no: 3, problem_summary: 'อีเมลแจ้งเตือนความปลอดภัยส่งมาช้ากว่าเวลาเกิดเหตุเป็นชั่วโมง', category_id: 'notification_issue', urgency: 'medium', department: 'System Admin' }
    ]
  },
  {
    id: 'chat-multi-005',
    customer_id: 'cust-005',
    company_id: COMPANY_ID,
    conversation: 'ลูกค้า: สวัสดีค่ะ จะสั่งซื้อคอร์สเรียนออนไลน์ มีโค้ดส่วนลด NEWLEARN200 พอกรอกโค้ดไปแล้ว ระบบแจ้งว่า "โค้ดนี้ไม่สามารถใช้งานได้" ทั้งที่ยังไม่หมดอายุและยอดสั่งซื้อเกิน 1,500 บาทตามเงื่อนไขค่ะ\nพนักงาน: สวัสดีครับคุณลูกค้า ขอตรวจสอบเงื่อนไขของโค้ดโปรโมชั่นสักครู่นะครับ\nลูกค้า: แล้วหน้าจอสรุปยอดเงินแปลกมากค่ะ ตัวเลขราคาเต็มกับราคาส่วนลดมันซ้อนทับกันอยู่บนปุ่มชำระเงิน มองไม่เห็นเลยว่ายอดที่ต้องจ่ายจริงเท่าไหร่\nลูกค้า: พอหนูพยายามจะกดปุ่ม "ลบคูปอง" เพื่อลองกรอกใหม่ ปุ่มมันก็กดไม่ติดเลยค่ะ คลิกหลายครั้งมากไม่มีปฏิกิริยาอะไรเลย\nพนักงาน: ตรวจสอบพบว่าคอร์สนี้มีส่วนลดขั้นต้นอยู่แล้วระบบจึงบล็อกโค้ดซ้อนครับ แต่เพื่อดูแลลูกค้า แอดมินได้เปิดสิทธิ์ส่วนลดพิเศษ 200 บาทให้ในระบบโดยตรงเรียบร้อยแล้วครับ พร้อมส่งเรื่องให้ทีม UI แก้ไขการทับซ้อนของตัวเลขราคาบนหน้าเว็บแล้วค่ะ',
    status: 'pending',
    priority: 'medium',
    category_id: 'promo_bonus',
    sub_category: 'Voucher Exclusion & UI Price Overlap & Button Lag',
    intent: 'ใช้โค้ดส่วนลดไม่ได้ หน้าจอตัวเลขราคาซ้อนทับกัน และปุ่มลบคูปองค้าง',
    root_cause: 'เงื่อนไขโปรโมชั่นห้ามใช้ซ้ำกับสินค้าลดราคา และ CSS Text Layout ซ้อนทับปุ่ม Action',
    sentiment: 'frustrated',
    urgency: 'medium',
    department: 'Marketing & UI/UX Team',
    keywords: ['NEWLEARN200', 'โค้ดใช้ไม่ได้', 'ราคาซ้อนทับปุ่ม', 'ปุ่มกดไม่ติด'],
    summary: 'ลูกค้าใช้โค้ด NEWLEARN200 ไม่ได้ พบการแสดงผลตัวเลขราคาทับซ้อนกับปุ่มชำระเงิน และปุ่มลบคูปองกดไม่ตอบสนอง แอดมินใส่ส่วนลดให้ในระบบโดยตรงและส่งเคสให้ทีม UI แก้ไข',
    recommended_reply: 'แอดมินได้ทำการปรับยอดส่วนลด 200 บาทให้ในบัญชีเรียบร้อยแล้วค่ะ สามารถกดชำระเงินในราคาพิเศษได้เลยนะคะ',
    detected_issues: [
      { issue_no: 1, problem_summary: 'ใช้โค้ดส่วนลด NEWLEARN200 ไม่ได้ทั้งที่ยอดถึงเกณฑ์', category_id: 'promo_bonus', urgency: 'medium', department: 'Marketing' },
      { issue_no: 2, problem_summary: 'ตัวเลขราคาส่วนลดซ้อนทับกับปุ่มชำระเงินจนมองไม่เห็นยอด', category_id: 'ui_rendering_issue', urgency: 'low', department: 'UI/UX Team' },
      { issue_no: 3, problem_summary: 'ปุ่มลบคูปองคลิกแล้วไม่ตอบสนอง ไม่สามารถลบโค้ดเดิมได้', category_id: 'interaction_lag', urgency: 'medium', department: 'Front-end Team' }
    ]
  },
  {
    id: 'chat-multi-006',
    customer_id: 'cust-006',
    company_id: COMPANY_ID,
    conversation: 'ลูกค้า: สวัสดีค่ะแอดมิน เข้าใช้งานเว็บไซต์ผ่านเน็ตบ้าน 3BB ไม่ได้เลยค่ะ หน้าจอขึ้น Error 502 Bad Gateway หน้าขาวไปเลย\nพนักงาน: สวัสดีครับคุณกัญญา ขออภัยในปัญหาการเชื่อมต่อด้วยครับ แนะนำให้ลองทดสอบสลับใช้งานสัญญาณอินเทอร์เน็ตมือถือดูชั่วคราวครับ\nลูกค้า: พอลองสลับมาใช้เน็ตมือถือ 5G เข้าหน้าเว็บได้ค่ะ แต่ระบบหน่วงช้ามากกก กดเปิดแต่ละหน้าหมุนโหลดเกือบ 20 วินาที หน้าแดชบอร์ดโหลดข้อมูลไม่ทันเลยค่ะ\nลูกค้า: อยากเสนอแนะทีมพัฒนาหน่อยค่ะ อยากให้ในแอปพลิเคชันมีระบบแคชข้อมูลแบบออฟไลน์ (Offline Cache) ไว้ดูข้อมูลสรุปย้อนหลังได้เวลาที่เน็ตหรือเซิร์ฟเวอร์ขัดข้องค่ะ\nพนักงาน: ขอบพระคุณสำหรับข้อเสนอแนะฟีเจอร์ Offline Cache มากครับ แอดมินได้บันทึกลงระบบคำขอฟีเจอร์ (Feature Request) ส่งให้ Product Manager แล้วครับ สำหรับปัญหา 502 ขณะนี้ทีม Network กำลังขยายแบนด์วิดท์เซิร์ฟเวอร์ คาดว่าจะกลับมาเสถียรภายใน 10 นาทีครับ',
    status: 'pending',
    priority: 'high',
    category_id: 'access_blocked',
    sub_category: 'Error 502 Gateway & Server Slowdown & Offline Cache Request',
    intent: 'เข้าเว็บไม่ได้ขึ้น 502 ระบบช้าหน่วงเมื่อใช้เน็ตมือถือ และเสนอขอระบบแคชออฟไลน์',
    root_cause: 'เกตเวย์เซิร์ฟเวอร์หลักโอเวอร์โหลดทำให้บาง ISP ติด 502 และระบบแคชยังไม่รองรับออฟไลน์',
    sentiment: 'neutral',
    urgency: 'high',
    department: 'DevOps & Product Team',
    keywords: ['502 Bad Gateway', 'เน็ตบ้านเข้าไม่ได้', 'ระบบหน่วงช้า', 'Offline Cache', 'ขอเพิ่มฟีเจอร์'],
    summary: 'ลูกค้าเข้าเว็บไม่ได้ขึ้น Error 502 บนเน็ตบ้าน สลับมาเน็ตมือถือเข้าได้แต่ระบบหน่วงช้ามาก และเสนอแนะขอฟีเจอร์ Offline Cache สำหรับดูข้อมูลตอนเน็ตหลุด แอดมินส่งเรื่องทีม DevOps และ Product',
    recommended_reply: 'ขณะนี้ทีม DevOps กำลังขยายแบนด์วิดท์เซิร์ฟเวอร์เพื่อแก้ปัญหา Error 502 นะคะ และได้บันทึกคำขอฟีเจอร์ Offline Cache ส่งให้ฝ่ายพัฒนาผลิตภัณฑ์แล้วค่ะ',
    detected_issues: [
      { issue_no: 1, problem_summary: 'เข้าหน้าเว็บผ่านเน็ตบ้านไม่ได้ ขึ้น Error 502 Bad Gateway', category_id: 'access_blocked', urgency: 'high', department: 'DevOps Team' },
      { issue_no: 2, problem_summary: 'ระบบทำงานช้าและหน่วงผิดปกติ โหลดหน้าจอเกิน 20 วินาที', category_id: 'performance_issue', urgency: 'medium', department: 'Infrastructure' },
      { issue_no: 3, problem_summary: 'ข้อเสนอแนะขอเพิ่มระบบ Offline Cache ในแอปพลิเคชัน', category_id: 'feature_request', urgency: 'low', department: 'Product Team' }
    ]
  },
  {
    id: 'chat-multi-007',
    customer_id: 'cust-007',
    company_id: COMPANY_ID,
    conversation: 'ลูกค้า: ช่วยเช็กด่วนครับ! ผมชำระเงินค่าแพ็กเกจผ่านบัตรเครดิต 4,900 บาท หน้าเว็บหมุนนานมากแล้วขึ้นว่า Payment Gateway Timeout ล้มเหลว แต่มี SMS จากธนาคารกสิกรแจ้งว่าตัดวงเงินบัตรเครดิตไปแล้วครับ\nพนักงาน: สวัสดีครับคุณประวิทย์ ขออภัยในเหตุการณ์ที่เกิดขึ้นอย่างยิ่งครับ ทางเราจะเร่งประสานงานตรวจสอบกับระบบ Payment Gateway ให้ทันทีครับ\nลูกค้า: พอเข้าไปดูในหน้ากระเป๋าเงินและหน้าสถานะแพ็กเกจ ก็ยังขึ้นว่าค้างชำระ ยอดเงินไม่เข้า วงเงินบัตรก็ตัดไปแล้ว เงินลอยอยู่ตรงไหนครับ\nลูกค้า: แล้วทำไมในระบบไม่มีเบอร์โทรศัพท์สายด่วนสำหรับติดต่อฝ่ายการเงินโดยตรงเลยครับ เกิดปัญหาตัดเงินแบบนี้ติดต่อผ่านแชตอย่างเดียวกว่าจะตอบ ลูกค้าใจคอไม่ดีครับ ขอร้องเรียนเรื่องช่องทางติดต่อฉุกเฉินด้วย\nพนักงาน: น้อมรับคำติชมเรื่องเบอร์ติดต่อฉุกเฉินครับ และขอเรียนแจ้งว่าระบบเกตเวย์ได้ยืนยันธุรกรรมเข้ามาแล้วครับ ขณะนี้แอดมินได้เปิดใช้งานแพ็กเกจให้คุณประวิทย์เรียบร้อยสมบูรณ์แล้วครับ',
    status: 'pending',
    priority: 'high',
    category_id: 'payment_gateway',
    sub_category: 'Credit Card Timeout & Balance Sync & Emergency Hotline Complaint',
    intent: 'บัตรเครดิตตัดเงินแต่เกตเวย์ไทม์เอาท์ ยอดเงินไม่เข้า และร้องเรียนไม่มีเบอร์โทรฉุกเฉิน',
    root_cause: 'Webhook ระหว่าง Payment Gateway กับระบบหลักตอบสนองช้า ทำให้สถานะหน้าเว็บไม่ปรับทันที',
    sentiment: 'angry',
    urgency: 'high',
    department: 'Finance & Customer Support',
    keywords: ['บัตรเครดิต 4900 บาท', 'Gateway Timeout', 'ตัดเงินแต่ยอดไม่เข้า', 'ร้องเรียนไม่มีเบอร์โทร'],
    summary: 'ลูกค้าชำระเงินผ่านบัตรเครดิต 4,900 บาท ขึ้น Gateway Timeout แต่ธนาคารตัดเงินแล้ว ยอดเงินไม่เข้าแพ็กเกจ และร้องเรียนว่าไม่มีเบอร์สายด่วนติดต่อฝ่ายการเงิน แอดมินประสานงานเปิดแพ็กเกจให้ทันที',
    recommended_reply: 'ทางระบบได้รับการยืนยันยอดเงิน 4,900 บาทจากเกตเวย์และเปิดใช้งานแพ็กเกจให้เรียบร้อยแล้วค่ะ ขออภัยในความไม่สะดวกและน้อมรับข้อร้องเรียนเรื่องเบอร์โทรประสานงานนะคะ',
    detected_issues: [
      { issue_no: 1, problem_summary: 'ชำระบัตรเครดิตขึ้น Payment Gateway Timeout แต่ธนาคารตัดเงินแล้ว', category_id: 'payment_gateway', urgency: 'high', department: 'Finance' },
      { issue_no: 2, problem_summary: 'ยอดเงินไม่ปรับเข้าสถานะแพ็กเกจ ยังขึ้นว่าค้างชำระ', category_id: 'deposit_withdrawal', urgency: 'high', department: 'Finance' },
      { issue_no: 3, problem_summary: 'ร้องเรียนว่าไม่มีเบอร์โทรฉุกเฉินสำหรับติดต่อฝ่ายการเงินโดยตรง', category_id: 'feedback_complaint', urgency: 'medium', department: 'Management' }
    ]
  },
  {
    id: 'chat-multi-008',
    customer_id: 'cust-008',
    company_id: COMPANY_ID,
    conversation: 'ลูกค้า: สวัสดีครับ พอดีผมเปิดใช้งานบนแท็บเล็ต Samsung Galaxy Tab S9 ครับ พอกดพิมพ์ในช่องกรอกที่อยู่ คีย์บอร์ดบนจอมันเด้งขึ้นมาบังช่องกรอกข้อมูลและปุ่มบันทึกทั้งหมดเลยครับ พิมพ์แบบมองไม่เห็นตัวหนังสือ\nพนักงาน: สวัสดีครับคุณวิชัย ขออภัยในปัญหาการใช้งานบนแท็บเล็ตด้วยครับ คุณวิชัยใช้งานผ่าน Samsung Internet หรือ Google Chrome ครับ\nลูกค้า: ใช้งานผ่าน Chrome ครับ แล้วรูปภาพโลโก้และรูปโปรไฟล์ในระบบบนหน้าแท็บเล็ตมันแสดงผลแตกเป็นเม็ดพิกเซลและภาพยืดผิดสัดส่วนมากครับ\nลูกค้า: พอกดย่อคีย์บอร์ดลง หน้าจอก็ดันค้างอยู่ตำแหน่งเดิม ไม่ยอมเลื่อนกลับลงมาเหมือนหน้าจอปกติ ต้องปิดแอปแล้วเปิดใหม่ตลอดเลยครับ\nพนักงาน: ได้รับข้อมูลปัญหาทั้ง 3 จุดเรียบร้อยครับ ทางทีม Front-end กำลังตรวจสอบการรองรับ Virtual Keyboard และ Responsive Media สำหรับหน้าจอแท็บเล็ต Android โดยตรงครับ คาดว่าจะออกแพตช์อัปเดตแก้เลย์เอาต์ให้ภายในวันพรุ่งนี้ครับ',
    status: 'pending',
    priority: 'low',
    category_id: 'device_compatibility',
    sub_category: 'Tablet Virtual Keyboard Overlay & Image Distortion & Scroll Lag',
    intent: 'ใช้งานแท็บเล็ตแล้วคีย์บอร์ดบังฟอร์ม รูปภาพแตกยืด และจอดันค้างไม่เลื่อนกลับ',
    root_cause: 'CSS Viewport Height ไม่รองรับ Android Keyboard Resize และ Asset Image ไม่ได้กำหนด Object-fit',
    sentiment: 'frustrated',
    urgency: 'low',
    department: 'Front-end & QA Team',
    keywords: ['Samsung Tab S9', 'คีย์บอร์ดบังฟอร์ม', 'รูปภาพแตกยืด', 'หน้าจอค้างไม่เลื่อนกลับ'],
    summary: 'ลูกค้าเปิดบนแท็บเล็ต Android พบปัญหา: 1) คีย์บอร์ดเด้งบังฟิลด์กรอกข้อมูล 2) รูปภาพในระบบแตกยืดผิดสัดส่วน 3) พอกดย่อคีย์บอร์ดหน้าจอค้างไม่คืนตำแหน่งเดิม ทีม Front-end เตรียมปล่อยแพตช์แก้ไข',
    recommended_reply: 'ได้รับภาพหน้าจอและรายละเอียดปัญหาแล้วค่ะ ทีม Front-end กำลังจัดทำแพตช์ปรับปรุงการแสดงผลบนแท็บเล็ต Android ให้โดยเร็วที่สุดนะคะ',
    detected_issues: [
      { issue_no: 1, problem_summary: 'คีย์บอร์ดเสมือนบนแท็บเล็ต Android เด้งขึ้นมาบังช่องกรอกข้อมูล', category_id: 'device_compatibility', urgency: 'low', department: 'Front-end Team' },
      { issue_no: 2, problem_summary: 'รูปภาพและไอคอนแตกเป็นพิกเซล แสดงผลยืดผิดสัดส่วน', category_id: 'ui_rendering_issue', urgency: 'low', department: 'Design Team' },
      { issue_no: 3, problem_summary: 'กดย่อคีย์บอร์ดลงแล้วหน้าจอค้าง ไม่เลื่อนกลับตำแหน่งเดิม', category_id: 'interaction_lag', urgency: 'low', department: 'QA Team' }
    ]
  },
  {
    id: 'chat-multi-009',
    customer_id: 'cust-009',
    company_id: COMPANY_ID,
    conversation: 'ลูกค้า: สวัสดีค่ะ วันนี้มีนัดหมายเข้ารับบริการช่วงบ่าย แต่ยังไม่ได้รับอีเมลและ SMS แจ้งเตือนรหัสยืนยันนัดหมายเลยค่ะ กลัวว่าจะไปใช้บริการไม่ได้\nพนักงาน: สวัสดีค่ะคุณสุภาพร ขอตรวจสอบข้อมูลการนัดหมายในระบบให้นะคะ\nลูกค้า: พอหนูพยายามจะล็อกอินเข้าไปดูใบนัดหมายในระบบด้วยตัวเอง พิมพ์รหัสผ่านไป 3 ครั้ง หน้าเว็บฟ้องว่า "บัญชีของคุณถูกระงับชั่วคราวเนื่องจากใส่รหัสผ่านผิดเกินกำหนด" ตอนนี้เข้าใช้งานอะไรไม่ได้เลยค่ะ\nลูกค้า: รบกวนเจ้าหน้าที่ช่วยยืนยันตัวตนและปลดล็อกความปลอดภัยของบัญชีให้ด่วนได้ไหมคะ ต้องรีบเข้าไปบันทึกข้อมูลก่อนเที่ยงนี้ค่ะ\nพนักงาน: ตรวจสอบพบบัญชีของคุณสุภาพรแล้วค่ะ แอดมินได้ทำการปลดล็อกบัญชีให้เรียบร้อยแล้วนะคะ พร้อมส่งรหัสผ่านใหม่และใบนัดหมายตรงเข้าทาง SMS และอีเมลให้ทั้งสองช่องทางเรียบร้อยแล้วค่ะ สามารถเข้าสู่ระบบได้ทันทีค่ะ',
    status: 'pending',
    priority: 'high',
    category_id: 'login_issue',
    sub_category: 'Missing Appointment Alert & Account Lockout & Security Reset',
    intent: 'ไม่ได้รับแจ้งเตือนนัดหมาย บัญชีถูกล็อกเนื่องจากใส่รหัสผิด และขอปลดล็อกด่วน',
    root_cause: 'ระบบ Notification Scheduler ล่าช้า และ Security Policy ทำการล็อกบัญชีเมื่อใส่รหัสผิดเกิน 3 ครั้ง',
    sentiment: 'anxious',
    urgency: 'high',
    department: 'Customer Service & Security',
    keywords: ['ไม่ได้รับแจ้งเตือนนัดหมาย', 'บัญชีถูกระงับชั่วคราว', 'ใส่รหัสผิด', 'ขอปลดล็อกบัญชีด่วน'],
    summary: 'ลูกค้าไม่ได้รับอีเมล/SMS แจ้งเตือนนัดหมาย พยายามล็อกอินเองแต่ใส่รหัสผิดจนบัญชีถูกล็อก ขอให้เจ้าหน้าที่ปลดล็อกด่วน แอดมินปลดล็อกและส่งใบนัดหมายตรงให้ทันที',
    recommended_reply: 'แอดมินได้ปลดล็อกบัญชีให้เรียบร้อยแล้วนะคะ พร้อมส่งรหัสผ่านชั่วคราวและใบนัดหมายไปทาง SMS และอีเมลให้เรียบร้อยแล้วค่ะ สามารถเข้าใช้งานได้ทันทีนะคะ',
    detected_issues: [
      { issue_no: 1, problem_summary: 'ไม่ได้รับอีเมลและ SMS แจ้งเตือนรหัสยืนยันการนัดหมาย', category_id: 'notification_issue', urgency: 'high', department: 'Customer Service' },
      { issue_no: 2, problem_summary: 'เข้าสู่ระบบไม่ได้ บัญชีถูกระงับชั่วคราวเนื่องจากใส่รหัสผิด', category_id: 'login_issue', urgency: 'high', department: 'Security Team' },
      { issue_no: 3, problem_summary: 'ต้องการให้ยืนยันตัวตนและปลดล็อกความปลอดภัยบัญชีอย่างเร่งด่วน', category_id: 'account_security', urgency: 'high', department: 'Security Team' }
    ]
  },
  {
    id: 'chat-multi-010',
    customer_id: 'cust-010',
    company_id: COMPANY_ID,
    conversation: 'ลูกค้า: รบกวนแอดมินตรวจสอบระบบด่วนที่สุดครับ! หน้าออกรายงานสรุปยอดภาษีประจำเดือน พอกดส่งคำขอ หน้าเว็บโหลดหมุนค้างอยู่ที่ 99% มาเกือบครึ่งชั่วโมงแล้วครับ\nพนักงาน: สวัสดีครับคุณธนากร ขออภัยในความไม่สะดวกอย่างยิ่งครับ ทางทีมงานกำลังเข้าตรวจสอบการทำงานของเซิร์ฟเวอร์ออกรายงานครับ\nลูกค้า: พอลองกดปุ่ม "ดาวน์โหลด PDF" ย้อนหลังจากรายการเดิม หน้าจอดันเด้งข้อความสีแดงขึ้นมาว่า "HTTP 500 Internal Server Error" ไม่สามารถดาวน์โหลดไฟล์ได้เลยครับ\nลูกค้า: ผมจำเป็นต้องนำเอกสารนี้ไปยื่นปิดงบด่วนภายในวันนี้ครับ ขอร้องเรียนเรื่องความเสถียรของระบบออกรายงานหน่อยครับ เกิดปัญหาช่วงสิ้นงวดตลอด ทำให้งานทางนี้เสียหายมากครับ\nพนักงาน: ทางทีมวิศวกรได้เข้าไปรีสตาร์ท Service ของตัว Report Engine และแก้ไข Memory Leak ให้เรียบร้อยแล้วครับ ตอนนี้แอดมินได้ดาวน์โหลดไฟล์ PDF รายงานฉบับสมบูรณ์และส่งแนบเข้าอีเมลของคุณธนากรโดยตรงเรียบร้อยแล้วครับ',
    status: 'pending',
    priority: 'high',
    category_id: 'page_load_freeze',
    sub_category: 'Report Generation Freeze & API 500 Error & Stability Complaint',
    intent: 'หน้าออกรายงานค้าง 99% ดาวน์โหลด PDF ขึ้น 500 Error และร้องเรียนระบบขัดข้อง',
    root_cause: 'ตัวประมวลผล PDF Report เกิด Memory Leak ทำให้ค้างและส่งผลให้ API ส่งกลับรหัส 500',
    sentiment: 'angry',
    urgency: 'high',
    department: 'Backend Engineering & Customer Care',
    keywords: ['รายงานหมุนค้าง 99%', 'HTTP 500 Error', 'ดาวน์โหลด PDF ไม่ได้', 'ร้องเรียนระบบไม่เสถียร'],
    summary: 'ลูกค้าออกรายงานสรุปภาษีแล้วหน้าจอค้าง 99% ดาวน์โหลดไฟล์ PDF ขึ้น 500 Internal Server Error และร้องเรียนเรื่องความไม่เสถียรของระบบช่วงปิดงบ ทีมวิศวกรแก้ไขและส่งไฟล์ให้ทางอีเมลเรียบร้อย',
    recommended_reply: 'ทีมวิศวกรได้แก้ไขระบบตัวสร้างรายงานเรียบร้อยแล้วค่ะ และแอดมินได้ส่งไฟล์ PDF รายงานฉบับสมบูรณ์ไปยังอีเมลของคุณธนากรเรียบร้อยแล้วนะคะ',
    detected_issues: [
      { issue_no: 1, problem_summary: 'หน้าออกรายงานภาษีหมุนค้างอยู่ที่ 99% ไม่ยอมประมวลผลให้เสร็จ', category_id: 'page_load_freeze', urgency: 'high', department: 'Backend Engineering' },
      { issue_no: 2, problem_summary: 'กดดาวน์โหลดไฟล์ PDF รายงานแล้วขึ้น HTTP 500 Internal Server Error', category_id: 'api_error', urgency: 'high', department: 'Backend Engineering' },
      { issue_no: 3, problem_summary: 'ร้องเรียนความไม่เสถียรของระบบที่เกิดขึ้นเป็นประจำในช่วงเวลาปิดงบด่วน', category_id: 'feedback_complaint', urgency: 'high', department: 'Customer Care' }
    ]
  }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function streamIngest() {
  console.log('🚀 เริ่มต้นการทยอยส่งแชตปัญหาจากลูกค้าเข้าสู่ระบบ (Simulated Real-Time Ingestion)...');
  console.log(`จำนวนแชตทั้งหมด: ${multiIssueChats.length} ชุด (สถานะเริ่มต้น: pending / รอดำเนินการ)\n`);

  for (let i = 0; i < multiIssueChats.length; i++) {
    const item = multiIssueChats[i];
    const timeStr = new Date().toLocaleTimeString('th-TH');

    console.log(`[${timeStr}] 📩 ได้รับแชตใหม่ (${i + 1}/${multiIssueChats.length}): "${item.id}" จากลูกค้า ${item.customer_id}`);
    console.log(`   หมวดหลัก: ${item.category_id} | ความเร่งด่วน: ${item.priority}`);
    console.log(`   ปัญหาซ้อนกัน: ${item.detected_issues.map(d => d.category_id).join(', ')}`);

    // 1. Insert chat record to chats table
    const chatPayload = {
      id: item.id,
      customer_id: item.customer_id,
      company_id: item.company_id,
      conversation: item.conversation,
      status: 'pending',
      priority: item.priority,
      category_id: item.category_id,
      sub_category: item.sub_category,
      intent: item.intent,
      root_cause: item.root_cause,
      sentiment: item.sentiment,
      urgency: item.urgency,
      department: item.department,
      keywords: item.keywords,
      summary: item.summary,
      recommended_reply: item.recommended_reply
    };

    const { error: chatErr } = await supabase.from('chats').upsert(chatPayload, { onConflict: 'id' });
    if (chatErr) {
      console.error(`   ❌ บันทึกแชต ${item.id} ล้มเหลว:`, chatErr.message);
    } else {
      console.log(`   ✅ แชต ${item.id} บันทึกลง Supabase สำเร็จ (Status: pending)`);
    }

    // 2. Insert sub-issues into chat_issues table
    const issuesPayload = item.detected_issues.map((iss) => ({
      chat_id: item.id,
      category_id: iss.category_id,
      priority: iss.urgency || item.priority,
      department: iss.department || item.department,
      summary: iss.problem_summary,
      recommended_reply: iss.recommended_reply || item.recommended_reply
    }));

    // Delete old issues for this chat if exists
    await supabase.from('chat_issues').delete().eq('chat_id', item.id);
    const { error: issuesErr } = await supabase.from('chat_issues').insert(issuesPayload);
    if (issuesErr) {
      console.warn(`   ⚠️ บันทึกตาราง chat_issues ไม่สำเร็จ:`, issuesErr.message);
    } else {
      console.log(`   🔗 บันทึกประเด็นปัญหาย่อย ${issuesPayload.length} รายการลงตาราง chat_issues เรียบร้อย`);
    }

    console.log('-------------------------------------------------------------');

    // Small delay between chats (2.5 seconds) to simulate realistic customer arrivals
    if (i < multiIssueChats.length - 1) {
      await sleep(2500);
    }
  }

  console.log('\n🎉 ส่งชุดข้อมูลปัญหาครบถ้วนทั้ง 10 ชุดเรียบร้อยแล้ว!');
}

streamIngest();
