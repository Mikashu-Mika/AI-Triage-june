import dotenv from 'dotenv';
import { insertCustomer, insertCategory, insertChat } from './supabase.js';
import { getEmbedding } from './ollama.js';

dotenv.config();

const sampleCustomers = [
  { id: 'cust-001', name: 'Somchai (สมชาย)', phone: '0812345678' },
  { id: 'cust-002', name: 'Somsri (สมศรี)', phone: '0823456789' },
  { id: 'cust-003', name: 'Anan (อนันต์)', phone: '0834567890' }
];

const sampleCategories = [
  { id: 'access_blocked', name: 'เข้าหน้าเว็บไม่ได้/ลิงก์เสีย', description: 'เข้าเว็บไซต์ไม่ได้, Error 403, 404, 502, 503, IP ถูกบล็อก, Cloudflare Block, DNS ผิดพลาด' },
  { id: 'deposit_withdrawal', name: 'ฝาก-ถอน', description: 'ฝากเงินไม่เข้า, ถอนเงินไม่ได้, ถอนเงินล่าช้า, ยอดเงินไม่อัปเดต, สลิปไม่ถูกต้อง, ธนาคารขัดข้อง' },
  { id: 'login_issue', name: 'ปัญหาการเข้าสู่ระบบ', description: 'ลืมรหัสผ่าน, เข้าสู่ระบบไม่ได้, OTP ไม่เข้า, บัญชีถูกล็อก, Session หมดอายุ, ยืนยันตัวตนไม่ผ่าน' },
  { id: 'registration', name: 'การสมัครสมาชิก', description: 'สมัครสมาชิกไม่ได้, ยืนยันเบอร์ไม่ได้, ยืนยันอีเมลไม่ได้, ข้อมูลซ้ำ, รหัสแนะนำไม่ถูกต้อง' },
  { id: 'device_compatibility', name: 'ปัญหาบราวเซอร์/อุปกรณ์', description: 'ใช้งานบนมือถือไม่ได้, Safari มีปัญหา, Chrome แสดงผลผิด, Firefox ใช้งานไม่ได้, Tablet แสดงผลผิด, ระบบไม่รองรับอุปกรณ์' },
  { id: 'page_load_freeze', name: 'หน้าเว็บค้าง/โหลดช้า', description: 'หน้าเว็บโหลดช้า, หน้าเว็บค้าง, โหลดไม่เสร็จ, หมุนไม่หยุด, เปิดหน้าไม่ได้' },
  { id: 'interaction_lag', name: 'กดปุ่มแล้วไม่ตอบสนอง', description: 'ปุ่มกดไม่ตอบสนอง, คลิกแล้วไม่มีอะไรเกิดขึ้น, ฟอร์มส่งไม่ได้, Popup ไม่เปิด, เมนูใช้งานไม่ได้' },
  { id: 'ui_rendering_issue', name: 'การแสดงผลผิดเพี้ยน', description: 'ตัวหนังสือซ้อนกัน, ปุ่มหาย, รูปภาพไม่ขึ้น, Layout เพี้ยน, สีผิดปกติ, Responsive ผิด' },
  { id: 'game_issue', name: 'ปัญหาการเล่นเกม', description: 'เข้าเกมไม่ได้, เกมค้าง, เกมเด้ง, ผลเกมผิด, เครดิตไม่อัปเดต, โบนัสไม่เข้า' },
  { id: 'promo_bonus', name: 'โปรโมชั่นและโบนัส', description: 'โบนัสไม่ได้รับ, โปรโมชั่นใช้งานไม่ได้, เทิร์นโอเวอร์ผิด, เครดิตโบนัสผิด, เงื่อนไขโปรโมชั่น' },
  { id: 'general_faq', name: 'สอบถามข้อมูลและกติกา', description: 'วิธีใช้งาน, กติกา, เวลาทำการ, ช่องทางติดต่อ, วิธีสมัคร, วิธีฝากถอน' },
  { id: 'feedback_complaint', name: 'ข้อเสนอแนะและร้องเรียน', description: 'ข้อเสนอแนะ, แจ้งปัญหาการบริการ, พนักงานบริการไม่ดี, ร้องเรียนระบบ, ขอปรับปรุงบริการ' },
  { id: 'notification_issue', name: 'ปัญหาการแจ้งเตือน', description: 'ไม่ได้รับอีเมล, ไม่ได้รับ SMS, ไม่ได้รับ OTP, ไม่ได้รับแจ้งเตือน, แจ้งเตือนล่าช้า' },
  { id: 'account_security', name: 'ความปลอดภัยของบัญชี', description: 'บัญชีถูกแฮก, เปลี่ยนรหัสผ่าน, เปลี่ยนเบอร์โทร, เปลี่ยนอีเมล, ยืนยันตัวตน' },
  { id: 'payment_gateway', name: 'ระบบการชำระเงิน/ธนาคาร', description: 'QR Code ใช้งานไม่ได้, PromptPay ขัดข้อง, โอนเงินไม่สำเร็จ, Gateway Error, Payment Timeout' },
  { id: 'api_error', name: 'ข้อผิดพลาดระบบ API', description: 'API Error, Server Error, Timeout, Internal Error, Service Unavailable' },
  { id: 'performance_issue', name: 'ประสิทธิภาพระบบช้า', description: 'ระบบช้า, CPU สูง, Memory สูง, ระบบหน่วง, ประสิทธิภาพลดลง' },
  { id: 'feature_request', name: 'ขอเพิ่มฟีเจอร์', description: 'ขอเพิ่มฟีเจอร์, ขอปรับปรุงระบบ, ขอเพิ่มเมนู, ขอเพิ่มรายงาน, ขอเพิ่ม API' },
  { id: 'other', name: 'หมวดหมู่อื่นๆ', description: 'คำถามทั่วไป, เรื่องที่ไม่เข้าหมวด, ต้องการสอบถามเพิ่มเติม, อื่น ๆ' }
];

const sampleChats = [
  {
    id: 'chat-001',
    customer_id: 'cust-001',
    conversation: 'ลูกค้า: สวัสดีครับ พอดีต้องการสอบถามเรื่องการถอนเงินครับ โอนเงินเข้าบัญชีแต่เงินยังไม่เข้าเลย\nพนักงาน: สวัสดีค่ะ ขอทราบสลิปการโอนเงินและบัญชีผู้ใช้ด้วยค่ะ',
    status: 'pending'
  },
  {
    id: 'chat-002',
    customer_id: 'cust-002',
    conversation: 'ลูกค้า: เข้าสู่ระบบไม่ได้ค่ะ มันขึ้นว่ารหัสผ่านไม่ถูกต้อง รบกวนรีเซ็ตให้หน่อยค่ะ\nพนักงาน: ยินดีค่ะ รบกวนขอเบอร์โทรศัพท์ที่ลงทะเบียนเพื่อยืนยันตัวตนด้วยค่ะ',
    status: 'pending'
  },
  {
    id: 'chat-003',
    customer_id: 'cust-003',
    conversation: 'ลูกค้า: สมัครโปรโมชั่นสมาชิกใหม่ฝากแรกของวัน 100% ไปแล้ว ต้องทำยังไงต่อครับถึงจะได้โบนัสเข้ากระเป๋า\nพนักงาน: สวัสดีค่ะ รบกวนแจ้งยูสเซอร์เนมเพื่อตรวจสอบเงื่อนไขยอดเทิร์นโอเวอร์นะคะ',
    status: 'pending'
  }
];

async function seed() {
  console.log('=== Starting Relational Seeding to Supabase (with Category Embeddings) ===');

  // 1. Seed Customers
  console.log('\nSeeding Customers...');
  for (const customer of sampleCustomers) {
    try {
      await insertCustomer(customer);
      console.log(`✅ Upserted Customer: ${customer.id} (${customer.name})`);
    } catch (error) {
      console.error(`❌ Failed to seed customer ${customer.id}: ${error.message}`);
    }
  }

  // 2. Seed Categories with Embeddings
  console.log('\nSeeding Categories (generating embeddings with BGE-M3)...');
  for (const category of sampleCategories) {
    try {
      console.log(`- Generating vector embedding for category: "${category.id}"`);
      const embedding = await getEmbedding(category.description || category.name);
      await insertCategory({
        ...category,
        embedding
      });
      console.log(`✅ Upserted Category: ${category.id} (${category.name}) with embedding`);
    } catch (error) {
      console.error(`❌ Failed to seed category ${category.id}: ${error.message}`);
    }
  }

  // 3. Seed Chats
  console.log('\nSeeding Chats...');
  for (const chat of sampleChats) {
    try {
      await insertChat(chat);
      console.log(`✅ Inserted Chat: ${chat.id} (Customer ID: ${chat.customer_id})`);
    } catch (error) {
      console.error(`❌ Failed to seed chat ${chat.id}: ${error.message}`);
    }
  }

  console.log('\n=== Seeding Finished Successfully ===');
}

seed();
