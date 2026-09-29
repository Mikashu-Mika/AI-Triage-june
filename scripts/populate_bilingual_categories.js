import { supabase } from '../src/supabase.js';

export const UNIFIED_BILINGUAL_CATEGORIES = {
  access_blocked: {
    name_th: 'เข้าหน้าเว็บไม่ได้/ลิงก์เสีย',
    name_en: 'Access Blocked',
    description: 'เข้าหน้าเว็บไม่ได้, ขึ้น 502 Bad Gateway, ลิงก์เสีย, โดนบล็อกการเข้าถึง'
  },
  account_security: {
    name_th: 'ความปลอดภัยของบัญชี',
    name_en: 'Account Security',
    description: 'ขอเปลี่ยนเบอร์โทรศัพท์, ตรวจสอบการเข้าถึง, เปลี่ยนรหัสผ่าน, บัญชีถูกแฮก, ยืนยันตัวตน'
  },
  api_error: {
    name_th: 'ข้อผิดพลาดระบบ API',
    name_en: 'API Error',
    description: 'API Error, Server Error, Timeout, Internal Error, Service Unavailable'
  },
  device_compatibility: {
    name_th: 'ปัญหาบราวเซอร์/อุปกรณ์',
    name_en: 'Device Compatibility',
    description: 'ใช้งานบนมือถือไม่ได้, Safari มีปัญหา, Chrome แสดงผลผิด, Firefox ใช้งานไม่ได้, Tablet แสดงผลผิด, ระบบไม่รองรับอุปกรณ์'
  },
  feature_request: {
    name_th: 'ขอเพิ่มฟีเจอร์',
    name_en: 'Feature Request',
    description: 'ขอเพิ่มฟีเจอร์, ขอปรับปรุงระบบ, ขอเพิ่มเมนู, ขอเพิ่มรายงาน, ขอเพิ่ม API'
  },
  feedback_complaint: {
    name_th: 'ข้อเสนอแนะและร้องเรียน',
    name_en: 'Feedback & Complaint',
    description: 'ข้อเสนอแนะ, แจ้งปัญหาการบริการ, พนักงานบริการไม่ดี, ร้องเรียนระบบ, ขอปรับปรุงบริการ'
  },
  game_issue: {
    name_th: 'ปัญหาเกี่ยวกับตัวเกม',
    name_en: 'Game Issue',
    description: 'เกมค้าง, หลุดกลางคัน, API timeout, โหลดเกมไม่ได้'
  },
  interaction_lag: {
    name_th: 'ระบบการทำงานล่าช้า',
    name_en: 'System Lag',
    description: 'การตอบสนองช้า, ปุ่มกดไม่ติด, หน่วง, คลิกไม่ไป'
  },
  login_issue: {
    name_th: 'ปัญหาระบบเข้าใช้งาน/ล็อกอิน',
    name_en: 'Login Issue',
    description: 'ลืมรหัสผ่าน, ไม่ได้รับ OTP, บัญชีถูกล็อก, เข้าสู่ระบบไม่ได้, รหัสผ่านไม่ถูกต้อง'
  },
  notification_issue: {
    name_th: 'ปัญหาการแจ้งเตือน',
    name_en: 'Notification Issue',
    description: 'ไม่ได้รับอีเมล, ไม่ได้รับ SMS, ไม่ได้รับ OTP, OTP ไม่เข้า, OTP ไม่ส่ง, ไม่ได้รับแจ้งเตือน, แจ้งเตือนล่าช้า'
  },
  page_load_freeze: {
    name_th: 'หน้าเว็บค้าง/โหลดช้า',
    name_en: 'Page Load / Freeze',
    description: 'หน้าเว็บโหลดช้า, หน้าเว็บค้าง, โหลดไม่เสร็จ, หมุนไม่หยุด, เปิดหน้าไม่ได้, ดูไม่ได้, ดูสตรีมไม่ได้, ดูบอลไม่ได้, เล่นสตรีมค้าง'
  },
  payment_gateway: {
    name_th: 'ระบบการชำระเงิน/ธนาคาร',
    name_en: 'Payment Gateway',
    description: 'QR Code ใช้งานไม่ได้, PromptPay ขัดข้อง, โอนเงินไม่สำเร็จ, Gateway Error, Payment Timeout'
  },
  performance_issue: {
    name_th: 'ประสิทธิภาพระบบช้า',
    name_en: 'Performance Issue',
    description: 'ระบบช้า, CPU สูง, Memory สูง, ระบบหน่วง, ประสิทธิภาพลดลง'
  },
  promo_bonus: {
    name_th: 'โปรโมชั่นและโบนัส',
    name_en: 'Promo & Bonus',
    description: 'โบนัสไม่ได้รับ, โปรโมชั่นใช้งานไม่ได้, เทิร์นโอเวอร์ผิด, เครดิตโบนัสผิด, เงื่อนไขโปรโมชั่น'
  },
  registration: {
    name_th: 'การสมัครสมาชิก',
    name_en: 'Registration',
    description: 'สมัครสมาชิกไม่ได้, ยืนยันเบอร์ไม่ได้, ยืนยันอีเมลไม่ได้, ข้อมูลซ้ำ, รหัสแนะนำไม่ถูกต้อง'
  },
  ui_rendering_issue: {
    name_th: 'ปัญหากราฟิก/การแสดงผลเว็บ',
    name_en: 'UI Rendering Issue',
    description: 'ภาพไม่โหลด, ปุ่มกดไม่ได้, หน้าจอกราฟิกค้าง, จอดำ, จอมืด, จอขาว, จอเขียว, Layout เพี้ยน'
  },
  vip_privilege: {
    name_th: 'สิทธิประโยชน์ระดับ VIP',
    name_en: 'VIP Privileges',
    description: 'บริการสมาชิกพิเศษ VIP, สิทธิพิเศษ VIP'
  },
  deposit_withdrawal: {
    name_th: 'การเงินและการชำระเงิน',
    name_en: 'Deposit & Withdrawal',
    description: 'ฝากเงินไม่เข้า, ถอนเงินไม่ได้, ถอนเงินล่าช้า, ยอดเงินไม่อัปเดต, โอนเงินแล้วยอดไม่ปรับ, สลิปไม่ตรง'
  },
  other: {
    name_th: 'เรื่องอื่นๆ',
    name_en: 'Other Inquiries',
    description: 'สอบถามข้อมูลทั่วไป, ขอเครดิตฟรี, มีโปรอะไรบ้าง, ขอบัญชีธนาคาร, ไม่ใช่ปัญหาของระบบ'
  }
};

async function checkColumnExists() {
  const { error } = await supabase
    .from('categories')
    .select('name_en')
    .limit(1);
  return !error;
}

async function main() {
  const hasNameEn = await checkColumnExists();
  console.log(`Database support for 'name_en' column: ${hasNameEn ? 'YES ✅' : 'NO (not yet added in schema) ⚠️'}`);

  const { data: existing, error } = await supabase.from('categories').select('*');
  if (error) {
    console.error('Fetch error:', error);
    return;
  }

  console.log(`Found ${existing.length} existing categories.`);
  let updatedCount = 0;

  for (const cat of existing) {
    const rawKey = cat.id.includes(':') ? cat.id.split(':')[1] : cat.id;
    const target = UNIFIED_BILINGUAL_CATEGORIES[rawKey];
    if (target) {
      const updatePayload = {
        name: target.name_th, // Pure Thai without parenthesis
        description: target.description
      };
      if (hasNameEn) {
        updatePayload.name_en = target.name_en; // Pure English
      }

      const { error: upErr } = await supabase
        .from('categories')
        .update(updatePayload)
        .eq('id', cat.id);

      if (upErr) {
        console.error(`Failed to update ${cat.id}:`, upErr.message);
      } else {
        updatedCount++;
      }
    } else {
      console.warn(`No target mapping for rawKey: ${rawKey} (${cat.id})`);
    }
  }

  console.log(`✅ Successfully updated ${updatedCount} categories with pure Thai names.`);
  if (!hasNameEn) {
    console.log(`
ℹ️ NOTE FOR MIKA:
To persist 'name_en' permanently in the Supabase database table, please run this 1 line in Supabase SQL Editor:
ALTER TABLE categories ADD COLUMN IF NOT EXISTS name_en TEXT;

Once executed, rerun: node scripts/populate_bilingual_categories.js
Our backend API already supports bilingual output dynamically in the meantime!
`);
  } else {
    console.log(`✅ Both 'name' (Thai) and 'name_en' (English) were persisted to Supabase!`);
  }
}

main().catch(console.error);
