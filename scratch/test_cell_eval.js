const KNOWN_CATEGORY_NAMES = {
  deposit_withdrawal:{th:"การเงินและการชำระเงิน",en:"Deposit & Withdrawal"},
  page_load_freeze:{th:"หน้าเว็บค้าง/โหลดช้า",en:"Page Load / Freeze"},
  ui_rendering_issue:{th:"ปัญหากราฟิก/การแสดงผลเว็บ",en:"UI Rendering Issue"},
  login_issue:{th:"ปัญหาระบบเข้าใช้งาน/ล็อกอิน",en:"Login Issue"},
  access_blocked:{th:"เข้าหน้าเว็บไม่ได้/ลิงก์เสีย",en:"Access Blocked"},
  promo_bonus:{th:"โปรโมชั่นและโบนัส",en:"Promo & Bonus"},
  game_issue:{th:"ปัญหาเกี่ยวกับตัวเกม",en:"Game Issue"},
  gameplay_issue:{th:"ปัญหาเกี่ยวกับตัวเกม",en:"Game Issue"},
  account_security:{th:"ความปลอดภัยของบัญชี",en:"Account Security"},
  api_error:{th:"ข้อผิดพลาดระบบ API",en:"API Error"},
  payment_gateway:{th:"ระบบการชำระเงิน/ธนาคาร",en:"Payment Gateway"},
  notification_issue:{th:"ปัญหาการแจ้งเตือน",en:"Notification Issue"},
  interaction_lag:{th:"ระบบการทำงานล่าช้า",en:"System Lag"},
  device_compatibility:{th:"ปัญหาบราวเซอร์/อุปกรณ์",en:"Device Compatibility"},
  registration:{th:"การสมัครสมาชิก",en:"Registration"},
  feature_request:{th:"ขอเพิ่มฟีเจอร์",en:"Feature Request"},
  feedback_complaint:{th:"ข้อเสนอแนะและร้องเรียน",en:"Feedback & Complaint"},
  performance_issue:{th:"ประสิทธิภาพระบบช้า",en:"Performance Issue"},
  vip_privilege:{th:"สิทธิประโยชน์ระดับ VIP",en:"VIP Privileges"},
  other:{th:"เรื่องอื่นๆ",en:"Other Inquiries"},
  not_a_problem:{th:"ไม่ใช่ปัญหา",en:"Not an Issue"}
};

function getBaseCatId(t) {
  return t && "string" == typeof t ? (t.includes(":") ? t.split(":").pop() : t) : "";
}

function getCategoryLabel(t, n = "th") {
  if (!t) return "en" === n ? "Other Inquiries" : "เรื่องอื่นๆ";

  if ("string" == typeof t) {
    let i = getBaseCatId(t);
    if (KNOWN_CATEGORY_NAMES[i]) return KNOWN_CATEGORY_NAMES[i][n] || KNOWN_CATEGORY_NAMES[i].th;
    let o = t.match(/^(.+?)\s*\(([^)]+)\)$/);
    return o ? ("en" === n ? o[2].trim() : o[1].trim()) : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(i) ? ("en" === n ? "Other Inquiries" : "เรื่องอื่นๆ") : t;
  }

  let i = getBaseCatId(t.id || "");
  if ("en" === n) {
    if (t.name_en && "string" == typeof t.name_en && t.name_en.trim()) return t.name_en.trim();
    if (KNOWN_CATEGORY_NAMES[i]?.en) return KNOWN_CATEGORY_NAMES[i].en;
    if (t.name) {
      let r = String(t.name).match(/^(.+?)\s*\(([^)]+)\)$/);
      if (r) return r[2].trim();
    }
    return t.name || t.title || t.id || "Other Inquiries";
  }
  if (t.name_th && "string" == typeof t.name_th && t.name_th.trim()) return t.name_th.trim();
  if (t.name) {
    let r = String(t.name).match(/^(.+?)\s*\(([^)]+)\)$/);
    return r ? r[1].trim() : t.name;
  }
  return KNOWN_CATEGORY_NAMES[i]?.th ? KNOWN_CATEGORY_NAMES[i].th : t.title || t.id || "เรื่องอื่นๆ";
}

async function run() {
  const catsRes = await fetch('https://ai-triage-eta.vercel.app/api/categories?company_id=2c3f46cc-fae8-4ef8-99e1-874dec8b2af2');
  const k = await catsRes.json();
  const e = { category_id: "deposit_withdrawal" };

  const a = k.find(t => t.id === e.category_id || getBaseCatId(t.id) === getBaseCatId(e.category_id));
  console.log('Matched a:', a);
  console.log('Result when o = "en":', getCategoryLabel(a || e.category_id, "en"));
  console.log('Result when o = "th":', getCategoryLabel(a || e.category_id, "th"));
}

run();
