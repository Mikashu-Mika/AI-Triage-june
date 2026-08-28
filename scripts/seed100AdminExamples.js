import { supabase } from '../src/supabase.js';

const companyId = '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2';
const taskType = 'admin_backoffice';

const admin100Examples = [
  // --- 1. ค้นหาข้อมูล (Search & Query - 18 Records) ---
  { input_text: 'แสดงรายการฝากเงินของวันนี้', expected_output: 'SELECT * FROM transactions WHERE type=deposit AND created_at=today' },
  { input_text: 'ลูกค้า cust-001 ฝากเงินล่าสุดเมื่อไหร่', expected_output: 'SELECT created_at FROM transactions WHERE customer_id=cust-001 AND type=deposit ORDER BY created_at DESC LIMIT 1' },
  { input_text: 'ค้นหาประวัติการถอนเงินของ cust-002', expected_output: 'SELECT * FROM transactions WHERE customer_id=cust-002 AND type=withdrawal ORDER BY created_at DESC' },
  { input_text: 'ขอดูรายละเอียดแชทของเคสด่วนที่สุดวันนี้', expected_output: 'SELECT * FROM chats WHERE priority=urgent AND created_at=today LIMIT 1' },
  { input_text: 'ค้นหาข้อมูลลูกค้าที่ชื่อ Somchai', expected_output: 'SELECT * FROM customers WHERE name LIKE %Somchai%' },
  { input_text: 'แสดงแชตที่มีการแจ้งเรื่องหน้าเว็บค้าง', expected_output: 'SELECT * FROM chats WHERE category_id=page_load_freeze' },
  { input_text: 'ขอสถิติการใช้งานระบบของวันนี้', expected_output: 'SELECT * FROM activity_logs WHERE created_at=today' },
  { input_text: 'ค้นหาคู่มือการดำเนินงานเรื่องการคีย์มือฝากเงิน', expected_output: 'SELECT * FROM knowledge_base WHERE title LIKE %ฝากเงิน%' },
  { input_text: 'ขอดูรายการโบนัสวันเกิดย้อนหลัง 30 วัน', expected_output: 'SELECT * FROM promotions WHERE category=birthday AND created_at >= 30_days_ago' },
  { input_text: 'แสดงรายชื่อลูกค้าที่สมัครใหม่สัปดาห์นี้', expected_output: 'SELECT * FROM customers WHERE created_at >= 7_days_ago' },
  { input_text: 'ค้นหาธุรกรรมฝากเงินที่มีมูลค่าสูงสุดวันนี้', expected_output: 'SELECT * FROM transactions WHERE type=deposit AND created_at=today ORDER BY amount DESC LIMIT 1' },
  { input_text: 'ขอประวัติการเข้าใช้งานล่าสุดของทีม Admin', expected_output: 'SELECT * FROM activity_logs WHERE user_name LIKE %Admin% ORDER BY created_at DESC LIMIT 10' },
  { input_text: 'แสดง Ticket ปัญหาที่รอดำเนินการแก้ไข', expected_output: 'SELECT * FROM chat_issues WHERE resolution != Solved' },
  { input_text: 'ค้นหารายการถอนเงินที่ใช้เวลานานเกิน 10 นาที', expected_output: 'SELECT * FROM transactions WHERE type=withdrawal AND duration_minutes > 10' },
  { input_text: 'ขอดูแชตย้อนหลังของแชท chatId-110804', expected_output: 'SELECT * FROM telegram_chat_logs WHERE chat_id=chatId-110804 ORDER BY created_at ASC' },
  { input_text: 'แสดงรายการปรับยอดเครดิตมือโดยทีม Finance วันนี้', expected_output: 'SELECT * FROM activity_logs WHERE action_type=MANUAL_ADJUSTMENT AND created_at=today' },
  { input_text: 'ค้นหาแคมเปญการตลาดที่เปิดใช้งานอยู่ทั้งหมด', expected_output: 'SELECT * FROM promotions WHERE status=active' },
  { input_text: 'ขอดูข้อมูลลูกค้าที่มีสถานะ VIP', expected_output: 'SELECT * FROM customers WHERE is_vip=true' },

  // --- 2. สรุปข้อมูล (Summarize - 17 Records) ---
  { input_text: 'สรุปสถิติแชทและปัญหาย้อนหลัง 7 วัน', expected_output: 'สรุปสถิติแชต ปัญหาหลัก และสัดส่วนระดับความด่วน 7 วันย้อนหลัง' },
  { input_text: 'สรุปภาพรวมปัญหาย้อนหลัง 30 วัน', expected_output: 'สรุปสถิติปัญหาทั้งหมด 30 วันย้อนหลังพร้อม % หมวดหมู่อันดับ 1-3' },
  { input_text: 'สรุปยอดเงินและธุรกรรมในย้อนหลัง 7 วัน', expected_output: 'สรุปยอดฝากรวม ยอดถอนรวม ยอดสุทธิ และรายการค้างปรับ 7 วัน' },
  { input_text: 'วันนี้ลูกค้าแจ้งปัญหาเรื่องอะไรมากที่สุด', expected_output: 'สรุปหมวดหมู่ปัญหาหลักอันดับ 1 ที่พบมากที่สุดในวันนี้' },
  { input_text: 'สรุปภาพรวมลูกค้าและการสมัครสมาชิกสัปดาห์นี้', expected_output: 'สรุปจำนวนลูกค้าทั้งหมด ลูกค้าใหม่ และความสนใจสมัครสมาชิก' },
  { input_text: 'สรุปผลการใช้งานโปรโมชั่นในเดือนนี้', expected_output: 'สรุปแคมเปญที่เปิดใช้งานและยอดแจกโบนัสรวมเดือนนี้' },
  { input_text: 'สรุปปัญหาด่วนทั้งหมดของวันนี้', expected_output: 'สรุปรายการเคส Urgent พร้อมเวลาที่เกิดเรื่องและหมวดหมู่' },
  { input_text: 'สรุปผลการตอบแชตของทีมแอดมินวันนี้', expected_output: 'สรุปจำนวนแชตที่แอดมินตอบและเวลาตอบเฉลี่ย' },
  { input_text: 'สรุปรายงานธุรกรรมการเงินประจำวัน', expected_output: 'สรุปยอดฝาก-ถอนสุทธิประจำวัน' },
  { input_text: 'สรุปปัญหาเกี่ยวกับหน้าเว็บค้างและโหลดช้า', expected_output: 'สรุปจำนวนเคสหน้าเว็บค้างและเวลาที่เกิดปัญหาถี่ที่สุด' },
  { input_text: 'สรุปผลกระทบทางธุรกิจจากปัญหาแชตย้อนหลัง 30 วัน', expected_output: 'สรุปคะแนนผลกระทบทางธุรกิจและหมวดหมู่ที่มีความเสี่ยงสูงสุด' },
  { input_text: 'สรุปสถิติการใช้งาน Telegram Bot ของผู้บริหาร', expected_output: 'สรุปจำนวนคำถามและหัวข้อที่ผู้บริหารสอบถามบอท' },
  { input_text: 'สรุปเคสปัญหาที่ได้รับการแก้ไขสำเร็จแล้ว', expected_output: 'สรุปจำนวนเคสสถานะ Solved แยกตามหมวดหมู่' },
  { input_text: 'สรุปยอดถอนเงินรวมประจำสัปดาห์', expected_output: 'สรุปยอดถอนเงินทั้งหมดและจำนวนรายการใน 7 วัน' },
  { input_text: 'สรุปหมวดหมู่ปัญหาที่เป็นอุปสรรคต่อการสมัครสมาชิก', expected_output: 'สรุปเคสการเข้าสู่ระบบและสมัครสมาชิกไม่ได้' },
  { input_text: 'สรุปสถิติผู้รับโบนัสวันเกิดประจำเดือน', expected_output: 'สรุปจำนวนสมาชิกที่เคลมโบนัสวันเกิดในเดือนนี้' },
  { input_text: 'สรุปการทำงานของระบบ AI Agent ในรอบ 24 ชั่วโมง', expected_output: 'สรุปจำนวน Query ที่ AIAgent ประมวลผลและเวลาตอบเฉลี่ย' },

  // --- 3. นับจำนวน (Count - 17 Records) ---
  { input_text: 'วันนี้มีรายการฝากเงินกี่รายการ', expected_output: 'COUNT transactions WHERE type=deposit AND created_at=today' },
  { input_text: 'วันนี้ยอดฝากรวมเท่าไหร่', expected_output: 'SUM deposit_amount WHERE created_at=today' },
  { input_text: 'วันนี้มีลูกค้าใหม่กี่คน', expected_output: 'COUNT customers WHERE created_at=today' },
  { input_text: 'ปัญหาด่วนที่สุดทั้งหมดมีเท่าไหร่คะ อะไรบ้าง', expected_output: 'COUNT chats WHERE priority=urgent' },
  { input_text: 'ใน 30 วันนี้ ปัญหาการฝากถอนมีทั้งหมดเท่าไหร่', expected_output: 'COUNT chats WHERE category_id=deposit_withdrawal AND created_at >= 30_days_ago' },
  { input_text: 'จำนวนลูกค้าทั้งหมดในระบบมีกี่คน', expected_output: 'COUNT customers' },
  { input_text: 'มีแคมเปญการตลาดที่เปิดใช้งานกี่แคมเปญ', expected_output: 'COUNT promotions WHERE status=active' },
  { input_text: 'วันนี้มีแชตแจ้งเรื่องฝากเงินแล้วเครดิตไม่เข้ากี่เคส', expected_output: 'COUNT chats WHERE category_id=deposit_withdrawal AND created_at=today' },
  { input_text: 'ย้อนหลัง 7 วันมีปัญหาเว็บค้างกี่รายการ', expected_output: 'COUNT chats WHERE category_id=page_load_freeze AND created_at >= 7_days_ago' },
  { input_text: 'วันนี้มีลูกค้าฝากเงินเกิน 100,000 บาทกี่คน', expected_output: 'COUNT DISTINCT customer_id WHERE type=deposit AND amount > 100000 AND created_at=today' },
  { input_text: 'มีเคสปัญหาระดับความด่วนสูง (High) กี่เรื่อง', expected_output: 'COUNT chats WHERE priority=high' },
  { input_text: 'มีรายการปรับยอดมือรอดำเนินการกี่รายการ', expected_output: 'COUNT transactions WHERE status=pending_manual_adjust' },
  { input_text: 'วันนี้มีคำถามจากผู้บริหารกี่ข้อความ', expected_output: 'COUNT telegram_chat_logs WHERE created_at=today' },
  { input_text: 'ในเดือนนี้มีผู้รับโบนัสวันเกิดกี่คน', expected_output: 'COUNT promotions WHERE category=birthday AND created_at=this_month' },
  { input_text: 'มีปัญหาเกี่ยวกับระบบเข้าสู่ระบบกี่กรณี', expected_output: 'COUNT chats WHERE category_id=login_issue' },
  { input_text: 'มีคู่มือขั้นตอนปฏิบัติงานอยู่ในระบบกี่บทความ', expected_output: 'COUNT knowledge_base WHERE is_active=true' },
  { input_text: 'มีสคริปต์ทดสอบ Benchmark ทั้งหมดกี่ชุด', expected_output: 'COUNT training_examples WHERE task_type=admin_backoffice' },

  // --- 4. เปรียบเทียบข้อมูล (Compare - 16 Records) ---
  { input_text: 'เปรียบเทียบยอดฝากกับยอดถอนใน 7 วันนี้', expected_output: 'COMPARE SUM(deposit) vs SUM(withdrawal) in 7 days' },
  { input_text: 'เปรียบเทียบจำนวนปัญหาแชตสัปดาห์นี้กับสัปดาห์ที่แล้ว', expected_output: 'COMPARE COUNT(chats) in 7 days vs previous 7 days' },
  { input_text: 'เปรียบเทียบจำนวนลูกค้าใหม่เดือนนี้กับเดือนที่แล้ว', expected_output: 'COMPARE COUNT(new_customers) this month vs last month' },
  { input_text: 'ปัญหาเรื่องเว็บค้างเทียบกับปัญหาฝากเงิน เรื่องไหนมากกว่ากัน', expected_output: 'COMPARE page_load_freeze count vs deposit_withdrawal count' },
  { input_text: 'เปรียบเทียบยอดฝากรวมระหว่าง 7 วัน กับ 30 วัน', expected_output: 'COMPARE total deposit in 7 days vs 30 days' },
  { input_text: 'สัดส่วนปัญหา Urgent เทียบกับปัญหาระดับ High มีเท่าไหร่', expected_output: 'COMPARE priority urgent count vs high count' },
  { input_text: 'เปรียบเทียบยอดฝากของ cust-001 กับ cust-002', expected_output: 'COMPARE total deposits of cust-001 vs cust-002' },
  { input_text: 'เปรียบเทียบผลตอบรับของแคมเปญโบนัสวันเกิดกับโบนัสสมาชิกใหม่', expected_output: 'COMPARE claims of birthday_bonus vs welcome_bonus' },
  { input_text: 'เปรียบเทียบจำนวนแชตช่วงเช้ากับช่วงค่ำวันนี้', expected_output: 'COMPARE chats count morning vs evening today' },
  { input_text: 'ยอดถอนเงินวันเสาร์-อาทิตย์เทียบกับวันธรรมดาเป็นอย่างไร', expected_output: 'COMPARE weekend withdrawal vs weekday withdrawal' },
  { input_text: 'เปรียบเทียบจำนวน Ticket ที่แก้ไขแล้วกับที่ยังรอดำเนินการ', expected_output: 'COMPARE resolved tickets vs pending tickets' },
  { input_text: 'เปรียบเทียบระยะเวลาตอบแชตของทีม Finance กับทีม Support', expected_output: 'COMPARE response time Finance vs Support' },
  { input_text: 'เปรียบเทียบอัตราการฝากเงินสำเร็จเทียบกับรายการค้างปรับ', expected_output: 'COMPARE success deposits count vs pending adjustments count' },
  { input_text: 'สัดส่วนปัญหาการเข้าสู่ระบบเทียบกับปัญหาโบนัสการตลาด', expected_output: 'COMPARE login_issue count vs promo_bonus count' },
  { input_text: 'เปรียบเทียบยอดคงเหลือสุทธิวันนี้กับเมื่อวาน', expected_output: 'COMPARE net balance today vs yesterday' },
  { input_text: 'เปรียบเทียบจำนวนคำถามผู้บริหารสัปดาห์นี้กับสัปดาห์ก่อน', expected_output: 'COMPARE telegram queries count this week vs last week' },

  // --- 5. ตรวจสอบสถานะ (Check Status - 16 Records) ---
  { input_text: 'มีรายการถอนที่ยัง Pending อยู่กี่รายการ', expected_output: 'COUNT transactions WHERE type=withdrawal AND status=pending' },
  { input_text: 'มี Ticket ไหนยังไม่ได้แก้ไขบ้าง', expected_output: 'SELECT * FROM chat_issues WHERE resolution != Solved' },
  { input_text: 'ตรวจสอบสถานะการทำงานของเซิร์ฟเวอร์ AI Agent', expected_output: 'Check AI Agent server health, Ollama status, and telegram polling' },
  { input_text: 'ตรวจสอบว่าระบบเชื่อมต่อ Supabase Database ได้ปกติไหม', expected_output: 'Check Supabase client connection and table status' },
  { input_text: 'มีแชทไหนที่เกิน 15 นาทียังไม่มีแอดมินตอบไหม', expected_output: 'SELECT * FROM chats WHERE unanswered_duration > 15m' },
  { input_text: 'ตรวจสอบสถานะการคีย์มือปรับยอดฝากของเคสด่วนวันนี้', expected_output: 'SELECT status FROM activity_logs WHERE action_type=MANUAL_ADJUSTMENT AND created_at=today' },
  { input_text: 'มีเคสที่มีความเสี่ยงกระทบรายได้ธุรกิจ (Revenue Risk) อยู่ไหม', expected_output: 'SELECT * FROM chats WHERE business_impact=Revenue Risk' },
  { input_text: 'ตรวจสอบว่าวันนี้มีการส่งแจ้งเตือนภัยความปลอดภัยไหม', expected_output: 'SELECT * FROM activity_logs WHERE action_type=SECURITY_ALERT AND created_at=today' },
  { input_text: 'ตรวจสอบสถานะการอัปเดตบทความใน Knowledge Base', expected_output: 'SELECT * FROM knowledge_base ORDER BY created_at DESC LIMIT 5' },
  { input_text: 'มีรายการธุรกรรมฝากเงินสถานะ Failed ในวันนี้ไหม', expected_output: 'SELECT * FROM transactions WHERE type=deposit AND status=failed AND created_at=today' },
  { input_text: 'ตรวจสอบว่าบัญชีลูกค้า cust-003 ถูกระงับหรือไม่', expected_output: 'SELECT status FROM customers WHERE id=cust-003' },
  { input_text: 'มีโปรโมชั่นไหนที่หมดอายุแล้วแต่ยังเปิดใช้งานอยู่ไหม', expected_output: 'SELECT * FROM promotions WHERE end_date < NOW() AND status=active' },
  { input_text: 'ตรวจสอบสถานะคิวการประมวลผลคำสั่ง AI (Queue Engine)', expected_output: 'Check queryQueue length and isProcessingQueue state' },
  { input_text: 'มี Log การเข้าใช้ระบบที่น่าสงสัยใน 24 ชม. ที่ผ่านมาไหม', expected_output: 'SELECT * FROM activity_logs WHERE details LIKE %suspicious% AND created_at >= 24h_ago' },
  { input_text: 'ตรวจสอบว่าสคริปต์ตรวจวัดผล Benchmark รันผ่านกี่เปอร์เซ็นต์', expected_output: 'SELECT accuracy_percentage FROM benchmark_results ORDER BY created_at DESC LIMIT 1' },
  { input_text: 'มีแชทของลูกค้ารายใดที่อยู่ในระดับฉุกเฉินสูงสุดขณะนี้', expected_output: 'SELECT * FROM chats WHERE priority=urgent AND resolution=Pending' },

  // --- 6. วิเคราะห์ข้อมูล (Analyze - 16 Records) ---
  { input_text: 'มีรายการธุรกรรมไหนผิดปกติบ้าง', expected_output: 'SELECT * FROM transactions WHERE is_flagged=true OR status=suspicious' },
  { input_text: 'วิเคราะห์สาเหตุหลักที่ทำให้ลูกค้าฝากเงินแล้วเครดิตไม่เข้า', expected_output: 'วิเคราะห์ root_cause จาก chat_issues หมวดฝาก-ถอนเงิน (เช่น ธนาคารปลายทางล่าช้า)' },
  { input_text: 'วิเคราะห์ช่วงเวลาที่ลูกค้าทักเข้ามาแจ้งปัญหาด่วนมากที่สุด', expected_output: 'วิเคราะห์ peak hours ของเคส Urgent ในแต่ละช่วงเวลาของวัน' },
  { input_text: 'วิเคราะห์ปัจจัยที่ทำให้หน้าเว็บค้างและโหลดช้าบ่อยขึ้น', expected_output: 'วิเคราะห์สถิติเคส page_load_freeze และเบราว์เซอร์หรืออุปกรณ์ที่พบปัญหา' },
  { input_text: 'วิเคราะห์พฤติกรรมการฝากเงินของลูกค้ารายใหญ่ (VIP)', expected_output: 'วิเคราะห์ยอดฝากเฉลี่ย ความถี่ และเวลาทำรายการของกลุ่มลูกค้า VIP' },
  { input_text: 'วิเคราะห์ประสิทธิผลของแคมเปญโบนัสวันเกิดเทียบกับยอดฝากเพิ่ม', expected_output: 'วิเคราะห์ ROI และยอดฝากของสมาชิกหลังรับโบนัสวันเกิด' },
  { input_text: 'วิเคราะห์แนวโน้มจำนวนปัญหาแชตในอีก 7 วันข้างหน้า', expected_output: 'วิเคราะห์ Trend line สถิติปัญหาแชตย้อนหลัง 30 วันเพื่อประเมินภาระงาน' },
  { input_text: 'วิเคราะห์จุดคอขวดที่ทำให้แอดมินตอบแชตล่าช้าในหมวดการเงิน', expected_output: 'วิเคราะห์เวลาเฉลี่ยที่ใช้ในการตรวจสอบสลิปและคีย์มือปรับยอด' },
  { input_text: 'วิเคราะห์อัตราการเลิกใช้งานของลูกค้าที่เคยแจ้งปัญหารุนแรง', expected_output: 'วิเคราะห์ Churn rate ของลูกค้าระดับ Urgent' },
  { input_text: 'วิเคราะห์หมวดหมู่ปัญหาที่ส่งผลกระทบต่อความพึงพอใจมากที่สุด', expected_output: 'วิเคราะห์ sentiment คะแนนความพึงพอใจแยกตามหมวดหมู่ปัญหา' },
  { input_text: 'วิเคราะห์ยอดฝากเงินที่ลดลงในบางช่วงวันว่าเกิดจากสาเหตุใด', expected_output: 'วิเคราะห์ความเชื่อมโยงระหว่างปัญหาหน้าเว็บค้างกับยอดฝากเงินลดลง' },
  { input_text: 'วิเคราะห์ความปลอดภัยในการร้องขอเบอร์โทรและรหัสผ่าน', expected_output: 'วิเคราะห์สถิติจำนวนครั้งที่ผู้ใช้พยายามถามรหัสผ่าน/เบอร์โทรที่ถูก Security Guardrail บล็อก' },
  { input_text: 'วิเคราะห์ประสิทธิภาพการตอบของ AI Agent ในการคัดกรองเคส', expected_output: 'วิเคราะห์ความแม่นยำ Intent Router และเวลาประมวลผลเฉลี่ย' },
  { input_text: 'วิเคราะห์สัดส่วนปัญหาการสมัครสมาชิกใหม่ว่าเกิดจากขั้นตอนใด', expected_output: 'วิเคราะห์ root_cause ในหมวด registration' },
  { input_text: 'วิเคราะห์ว่าช่องทางการชำระเงินใดเกิดปัญหาสลิปค้างมากที่สุด', expected_output: 'วิเคราะห์ payment_gateway สถิติตามธนาคารปลายทาง' },
  { input_text: 'วิเคราะห์สรุปผลความสำเร็จในการดำเนินงาน Backoffice ประจำเดือน', expected_output: 'วิเคราะห์ภาพรวม KPI ยอดการเงิน จำนวนลูกค้า และเคสปัญหาที่แก้ไขได้สำเร็จ' }
];

async function seed100AdminExamples() {
  console.log('🚀 Starting 100 Admin Backoffice Training Examples Seeding...\n');

  // 1. Clean existing training_examples
  const { error: delErr } = await supabase
    .from('training_examples')
    .delete()
    .neq('company_id', '00000000-0000-0000-0000-000000000000');

  if (delErr) {
    console.error('❌ Error cleaning training_examples:', delErr.message);
    return;
  }
  console.log('🧹 Cleaned all old training_examples records from Supabase.');

  // 2. Prepare payload
  const payload = admin100Examples.map(item => ({
    company_id: companyId,
    input_text: item.input_text,
    expected_output: item.expected_output,
    task_type: taskType
  }));

  // 3. Batch insert into Supabase
  const { data, error } = await supabase.from('training_examples').insert(payload);

  if (error) {
    console.error('❌ Error inserting 100 Admin examples:', error.message);
  } else {
    console.log(`\n🎉 SUCCESS! Inserted EXACTLY ${payload.length} Admin Backoffice Training Examples into Supabase!`);
  }

  // 4. Verify count
  const { count, error: countErr } = await supabase
    .from('training_examples')
    .select('*', { count: 'exact', head: true });

  console.log(`📊 Verified training_examples Record Count in Supabase: ${count} rows.`);
}

seed100AdminExamples().then(() => process.exit(0));
