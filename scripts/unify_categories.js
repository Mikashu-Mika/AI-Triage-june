import { supabase } from '../src/supabase.js';

const UNIFIED_CATEGORIES = {
  access_blocked: {
    name: 'เข้าหน้าเว็บไม่ได้/ลิงก์เสีย (Access Blocked)',
    description: 'เข้าหน้าเว็บไม่ได้, ขึ้น 502 Bad Gateway, ลิงก์เสีย, โดนบล็อกการเข้าถึง'
  },
  account_security: {
    name: 'ความปลอดภัยของบัญชี (Account Security)',
    description: 'ขอเปลี่ยนเบอร์โทรศัพท์, ตรวจสอบการเข้าถึง, เปลี่ยนรหัสผ่าน, บัญชีถูกแฮก, ยืนยันตัวตน'
  },
  api_error: {
    name: 'ข้อผิดพลาดระบบ API (API Error)',
    description: 'API Error, Server Error, Timeout, Internal Error, Service Unavailable'
  },
  device_compatibility: {
    name: 'ปัญหาบราวเซอร์/อุปกรณ์ (Device Compatibility)',
    description: 'ใช้งานบนมือถือไม่ได้, Safari มีปัญหา, Chrome แสดงผลผิด, Firefox ใช้งานไม่ได้, Tablet แสดงผลผิด, ระบบไม่รองรับอุปกรณ์'
  },
  feature_request: {
    name: 'ขอเพิ่มฟีเจอร์ (Feature Request)',
    description: 'ขอเพิ่มฟีเจอร์, ขอปรับปรุงระบบ, ขอเพิ่มเมนู, ขอเพิ่มรายงาน, ขอเพิ่ม API'
  },
  feedback_complaint: {
    name: 'ข้อเสนอแนะและร้องเรียน (Feedback & Complaint)',
    description: 'ข้อเสนอแนะ, แจ้งปัญหาการบริการ, พนักงานบริการไม่ดี, ร้องเรียนระบบ, ขอปรับปรุงบริการ'
  },
  game_issue: {
    name: 'ปัญหาเกี่ยวกับตัวเกม (Game Issue)',
    description: 'เกมค้าง, หลุดกลางคัน, API timeout, โหลดเกมไม่ได้'
  },
  interaction_lag: {
    name: 'ระบบการทำงานล่าช้า (System Lag)',
    description: 'การตอบสนองช้า, ปุ่มกดไม่ติด, หน่วง, คลิกไม่ไป'
  },
  login_issue: {
    name: 'ปัญหาระบบเข้าใช้งาน/ล็อกอิน (Login Issue)',
    description: 'ลืมรหัสผ่าน, ไม่ได้รับ OTP, บัญชีถูกล็อก, เข้าสู่ระบบไม่ได้, รหัสผ่านไม่ถูกต้อง'
  },
  notification_issue: {
    name: 'ปัญหาการแจ้งเตือน (Notification Issue)',
    description: 'ไม่ได้รับอีเมล, ไม่ได้รับ SMS, ไม่ได้รับ OTP, OTP ไม่เข้า, OTP ไม่ส่ง, ไม่ได้รับแจ้งเตือน, แจ้งเตือนล่าช้า'
  },
  page_load_freeze: {
    name: 'หน้าเว็บค้าง/โหลดช้า (Page Load / Freeze)',
    description: 'หน้าเว็บโหลดช้า, หน้าเว็บค้าง, โหลดไม่เสร็จ, หมุนไม่หยุด, เปิดหน้าไม่ได้, ดูไม่ได้, ดูสตรีมไม่ได้, ดูบอลไม่ได้, เล่นสตรีมค้าง'
  },
  payment_gateway: {
    name: 'ระบบการชำระเงิน/ธนาคาร (Payment Gateway)',
    description: 'QR Code ใช้งานไม่ได้, PromptPay ขัดข้อง, โอนเงินไม่สำเร็จ, Gateway Error, Payment Timeout'
  },
  performance_issue: {
    name: 'ประสิทธิภาพระบบช้า (Performance Issue)',
    description: 'ระบบช้า, CPU สูง, Memory สูง, ระบบหน่วง, ประสิทธิภาพลดลง'
  },
  promo_bonus: {
    name: 'โปรโมชั่นและโบนัส (Promo & Bonus)',
    description: 'โบนัสไม่ได้รับ, โปรโมชั่นใช้งานไม่ได้, เทิร์นโอเวอร์ผิด, เครดิตโบนัสผิด, เงื่อนไขโปรโมชั่น'
  },
  registration: {
    name: 'การสมัครสมาชิก (Registration)',
    description: 'สมัครสมาชิกไม่ได้, ยืนยันเบอร์ไม่ได้, ยืนยันอีเมลไม่ได้, ข้อมูลซ้ำ, รหัสแนะนำไม่ถูกต้อง'
  },
  ui_rendering_issue: {
    name: 'ปัญหากราฟิก/การแสดงผลเว็บ (UI Rendering Issue)',
    description: 'ภาพไม่โหลด, ปุ่มกดไม่ได้, หน้าจอกราฟิกค้าง, จอดำ, จอมืด, จอขาว, จอเขียว, Layout เพี้ยน'
  },
  vip_privilege: {
    name: 'สิทธิประโยชน์ระดับ VIP (VIP Privileges)',
    description: 'บริการสมาชิกพิเศษ VIP, สิทธิพิเศษ VIP'
  },
  deposit_withdrawal: {
    name: 'การเงินและการชำระเงิน (Deposit & Withdrawal)',
    description: 'ฝากเงินไม่เข้า, ถอนเงินไม่ได้, ถอนเงินล่าช้า, ยอดเงินไม่อัปเดต, โอนเงินแล้วยอดไม่ปรับ, สลิปไม่ตรง'
  },
  other: {
    name: 'เรื่องอื่นๆ (Other Inquiries)',
    description: 'สอบถามข้อมูลทั่วไป, ขอเครดิตฟรี, มีโปรอะไรบ้าง, ขอบัญชีธนาคาร, ไม่ใช่ปัญหาของระบบ'
  }
};

async function main() {
  const { data: existing, error } = await supabase.from('categories').select('*');
  if (error) {
    console.error('Fetch error:', error);
    return;
  }

  console.log(`Found ${existing.length} existing categories.`);
  let updatedCount = 0;

  for (const cat of existing) {
    const rawKey = cat.id.includes(':') ? cat.id.split(':')[1] : cat.id;
    const target = UNIFIED_CATEGORIES[rawKey];
    if (target) {
      const { error: upErr } = await supabase
        .from('categories')
        .update({
          name: target.name,
          description: target.description
        })
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

  // Ensure Alpha Support has vip_privilege
  const alphaId = '2e65829a-6a60-4022-8289-0fe64ec98fae';
  const alphaVip = `${alphaId}:vip_privilege`;
  const hasAlphaVip = existing.some(c => c.id === alphaVip);
  if (!hasAlphaVip) {
    console.log('Inserting missing vip_privilege for Alpha Support...');
    const { error: insErr } = await supabase.from('categories').insert({
      id: alphaVip,
      company_id: alphaId,
      name: UNIFIED_CATEGORIES.vip_privilege.name,
      description: UNIFIED_CATEGORIES.vip_privilege.description
    });
    if (insErr) console.error('Insert vip_privilege error:', insErr.message);
    else console.log('✅ Inserted vip_privilege for Alpha Support.');
  }

  console.log(`Successfully updated ${updatedCount} categories in Supabase!`);
}

main().catch(console.error);
