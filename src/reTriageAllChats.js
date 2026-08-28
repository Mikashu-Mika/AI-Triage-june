import { supabase } from './supabase.js';

function classifySentence(text, mainCategory = 'other') {
  const lower = (text || '').toLowerCase();

  // 0. General Conversational / Inquiries -> Category: OTHER (เรื่องอื่นๆ)
  if (lower.includes('ต้องทำยังไง') || lower.includes('ช่วยดูให้ที') || lower.includes('ช่วยเช็กให้หน่อย') || lower.includes('ช่วยเช็คให้หน่อย') || lower.includes('ช่วยดูให้หน่อย') || lower.includes('ช่วยที') || lower.includes('แอดครับ') || lower.includes('สวัสดี') || lower.includes('ขอบคุณ')) {
    if (!lower.includes('ไม่ได้') && !lower.includes('ไม่เข้า') && !lower.includes('ผิด') && !lower.includes('ค้าง') && !lower.includes('ช้า') && !lower.includes('หาย') && !lower.includes('ซ้อนกัน')) {
      return 'other';
    }
  }

  // 1. Access Blocked (เข้าหน้าเว็บไม่ได้/ลิงก์เสีย)
  if (lower.includes('error 502') || lower.includes('502') || lower.includes('504') || lower.includes('404') || lower.includes('เข้าเว็บไม่ได้') || lower.includes('เข้าหน้าเว็บไม่ได้') || lower.includes('ลิงก์เสีย') || lower.includes('เว็บเข้าไม่ได้') || lower.includes('โดเมน')) return 'access_blocked';

  // 2. Notification / OTP / SMS (ปัญหาการแจ้งเตือน)
  if (lower.includes('otp') || lower.includes('sms') || lower.includes('แจ้งเตือน') || lower.includes('รหัสยืนยัน') || lower.includes('ไม่มีข้อความ') || lower.includes('ส่งใหม่')) return 'notification_issue';

  // 3. UI Rendering Issue (การแสดงผลผิดเพี้ยน / ตัวหนังสือซ้อนกัน / ปุ่มหาย / แสดงไม่ครบ / กระตุก)
  if (lower.includes('แสดงไม่ครบ') || lower.includes('บางปุ่มแสดงไม่ครบ') || lower.includes('ปุ่มบางปุ่มแสดงไม่ครบ') || lower.includes('ปุ่มเมนูบางปุ่มหายไป') || lower.includes('ปุ่มหาย') || lower.includes('เมนูหาย') || lower.includes('ซ้อนกัน') || lower.includes('ตัวหนังสือซ้อนกัน') || lower.includes('รูปภาพซ้อนกัน') || lower.includes('กระตุก') || lower.includes('รูปไม่ขึ้น') || lower.includes('แสดงผลไม่เหมือนเดิม') || lower.includes('แสดงไม่เต็มจอ') || lower.includes('ชิดขอบ') || lower.includes('เพี้ยน') || lower.includes('จอมืด') || lower.includes('จอดำ') || lower.includes('จอขาว')) return 'ui_rendering_issue';

  // 4. Page Load / Freeze / Lag (หน้าเว็บค้าง/โหลดช้า)
  if (lower.includes('โหลดช้า') || lower.includes('ช้ามาก') || lower.includes('หน้าเว็บช้า') || lower.includes('ค้าง') || lower.includes('โหลดอยู่นาน') || lower.includes('เกมค้าง') || lower.includes('หมุน') || lower.includes('โหลดไม่ครบ') || lower.includes('หนืด') || lower.includes('สะดุด') || lower.includes('โหลดไม่ขึ้น') || lower.includes('เด้ง')) return 'page_load_freeze';

  // 5. Account Security & Login (ปัญหาการเข้าสู่ระบบ/บัญชี)
  if (lower.includes('รหัสไม่ถูกต้อง') || lower.includes('รหัสผ่านไม่ถูกต้อง') || lower.includes('รีเซ็ตรหัส') || lower.includes('รีเซ็ต') || lower.includes('รหัสผิด') || lower.includes('เข้าได้อยู่') || lower.includes('พาสเวิร์ด') || lower.includes('เบอร์โทรนี้ถูกใช้งาน') || lower.includes('ถูกใช้งานแล้ว') || lower.includes('ลืมรหัส') || lower.includes('รหัสผ่าน') || lower.includes('แฮก') || lower.includes('ถูกแฮก') || lower.includes('รหัสผ่านผิด') || lower.includes('เข้าไม่ได้') || lower.includes('เข้าสู่ระบบ') || lower.includes('ล็อกอิน') || lower.includes('ล๊อกอิน') || lower.includes('login') || lower.includes('เข้าบัญชี') || lower.includes('ใช้งานบัญชี') || lower.includes('เด้งกลับหน้าแรก') || lower.includes('เข้าไม่ได้เลย') || lower.includes('บัญชีมีปัญหา') || lower.includes('บัญชีถูกล็อก')) return 'login_issue';

  // 6. Account Security (ความปลอดภัยของบัญชี)
  if (lower.includes('เปลี่ยนเบอร์') || lower.includes('เปลี่ยนข้อมูล') || lower.includes('แก้ไขข้อมูล') || lower.includes('ข้อมูลบัญชี') || lower.includes('ความปลอดภัย') || lower.includes('อายัด')) return 'account_security';

  // 7. Feedback Complaint (ข้อเสนอแนะและร้องเรียน)
  if (lower.includes('เสียเวลา') || lower.includes('เสียเวลามาก') || lower.includes('ตรวจสอบเกมนี้ให้จริงจัง') || lower.includes('จริงจังหน่อย') || lower.includes('ไม่มีใครตอบ') || lower.includes('รอนานมาก') || lower.includes('ส่งข้อความไปหลายครั้ง') || lower.includes('ร้องเรียน') || lower.includes('ต้องการให้ตรวจสอบ') || lower.includes('แจ้งผลให้ชัดเจน') || lower.includes('ไม่เข้าใจว่าระบบเป็นอะไร')) return 'feedback_complaint';

  // 8. Promo & Bonus (โปรโมชั่นและโบนัส)
  if (lower.includes('โปรโมชั่น') || lower.includes('โบนัส') || lower.includes('โปร') || lower.includes('ของขวัญวันเกิด') || lower.includes('สิทธิ์')) return 'promo_bonus';

  // 9. Deposit & Withdrawal (ฝาก-ถอน)
  if (lower.includes('โอนเงิน') || lower.includes('ฝาก') || lower.includes('ถอน') || lower.includes('ยอดเงิน') || lower.includes('ยอดไม่เข้า') || lower.includes('ยอดยังไม่เข้า') || lower.includes('เงินถูกหัก') || lower.includes('หักเงิน') || lower.includes('เงินไม่เข้า') || lower.includes('ยอดในเว็บ') || lower.includes('รายการถอน') || lower.includes('ถอนเงิน') || lower.includes('เงินยังไม่เข้า') || lower.includes('เครดิตไม่เข้า') || lower.includes('เครดิตยังไม่เข้า')) return 'deposit_withdrawal';

  // 10. Interaction Lag (กดปุ่มแล้วไม่ตอบสนอง)
  if (lower.includes('ไม่ตอบสนอง') || lower.includes('ปุ่มไม่ตอบสนอง') || lower.includes('กดยืนยันไม่ได้') || lower.includes('กดปุ่ม') || lower.includes('กดสมัครไม่ได้') || lower.includes('กดไม่ได้') || lower.includes('รีเฟรช') || lower.includes('รีเฟรชหลายรอบ') || lower.includes('ข้อมูลหาย')) return 'interaction_lag';

  // 11. Device Compatibility (ปัญหาเบราว์เซอร์/อุปกรณ์)
  if (lower.includes('มือถือ') || lower.includes('คอมพิวเตอร์') || lower.includes('อุปกรณ์') || lower.includes('chrome') || lower.includes('safari') || lower.includes('ไอโฟน') || lower.includes('แอนดรอยด์') || lower.includes('เครื่อง') || lower.includes('มือถือไม่รองรับ')) return 'device_compatibility';

  // 12. Game Issue (ปัญหาการเล่นเกม)
  if (lower.includes('เกมนี้เล่นไม่ได้เลย') || lower.includes('เข้าเกม') || lower.includes('คาสิโน') || lower.includes('เล่นเกม') || lower.includes('สล็อต') || lower.includes('เกม')) return 'game_issue';

  // 13. Registration (การสมัครสมาชิก)
  if (lower.includes('สมัคร') || lower.includes('สมัครสมาชิก')) return 'registration';

  // 14. Payment Gateway (ระบบการชำระเงิน/ธนาคาร)
  if (lower.includes('payment') || lower.includes('timeout') || lower.includes('ธนาคาร') || lower.includes('สแกน qr')) return 'payment_gateway';

  // 15. API Error (ข้อผิดพลาดระบบ API)
  if (lower.includes('service unavailable') || lower.includes('api error') || lower.includes('503') || lower.includes('500')) return 'api_error';

  // 16. Contextual Fallback
  if (mainCategory && mainCategory !== 'other') {
    return mainCategory;
  }

  return 'other';
}

function classifyPriority(catId) {
  if (catId === 'deposit_withdrawal' || catId === 'login_issue' || catId === 'access_blocked' || catId === 'feedback_complaint') return 'high';
  if (catId === 'promo_bonus' || catId === 'page_load_freeze' || catId === 'ui_rendering_issue' || catId === 'interaction_lag') return 'medium';
  return 'low';
}

function classifyDepartment(catId) {
  if (catId === 'deposit_withdrawal') return 'finance';
  if (catId === 'promo_bonus') return 'marketing';
  if (catId === 'login_issue' || catId === 'notification_issue' || catId === 'account_security') return 'security';
  if (catId === 'feedback_complaint') return 'customer_service';
  if (catId === 'access_blocked' || catId === 'page_load_freeze' || catId === 'ui_rendering_issue' || catId === 'interaction_lag' || catId === 'device_compatibility' || catId === 'game_issue') return 'technical';
  return 'customer_service';
}

function classifyRecommendedReply(catId) {
  if (catId === 'access_blocked') return 'เจ้าหน้าที่กำลังเร่งประสานงานทีม Tech และผู้ดูแลโดเมนเพื่อตรวจสอบลิ้งก์ทางเข้าและสถานะระบบ Server ด่วนค่ะ';
  if (catId === 'deposit_withdrawal') return 'เจ้าหน้าที่กำลังประสานงานตรวจสอบยอดรายการเงินให้ค่ะ';
  if (catId === 'promo_bonus') return 'เจ้าหน้าที่กำลังตรวจสอบสิทธิ์โปรโมชั่นและโบนัสให้ค่ะ';
  if (catId === 'feedback_complaint') return 'ต้องขออภัยในความไม่สะดวกอย่างสูงค่ะ ทางเราจะเร่งประสานงานตรวจสอบและตอบกลับโดยเร็วที่สุดค่ะ';
  if (catId === 'page_load_freeze') return 'เจ้าหน้าที่กำลังส่งเรื่องให้ทีม Tech ตรวจสอบระบบหน้าเว็บค่ะ';
  if (catId === 'ui_rendering_issue') return 'เจ้าหน้าที่กำลังตรวจสอบการแสดงผลหน้าเว็บและรูปภาพให้ค่ะ';
  if (catId === 'login_issue') return 'เจ้าหน้าที่กำลังตรวจสอบการเข้าสู่ระบบและสถานะการสมัครสมาชิกให้ค่ะ';
  if (catId === 'notification_issue') return 'เจ้าหน้าที่กำลังตรวจสอบระบบแจ้งเตือน OTP/SMS ให้ค่ะ';
  if (catId === 'interaction_lag') return 'เจ้าหน้าที่รับเรื่องและกำลังดำเนินการตรวจสอบให้อย่างเร่งด่วนค่ะ';
  return 'เจ้าหน้าที่รับเรื่องเรียบร้อยและกำลังประสานงานตรวจสอบให้ค่ะ';
}

async function reTriageAllDatabaseChats() {
  console.log('Fetching ALL chats from Supabase...');
  const { data: chats, error } = await supabase
    .from('chats')
    .select('id, category_id, conversation');

  if (error || !chats) {
    console.error('Failed to fetch chats:', error?.message);
    process.exit(1);
  }

  console.log(`Found ${chats.length} total chats. Starting automated bulk Re-Triage...`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < chats.length; i++) {
    const chat = chats[i];
    if (!chat.conversation) {
      skippedCount++;
      continue;
    }

    const sentences = chat.conversation
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (sentences.length === 0) {
      skippedCount++;
      continue;
    }

    // Group sentences by categorized issue topic
    const topicMap = {};
    sentences.forEach(rawText => {
      const cleanText = rawText.replace(/^(ลูกค้า|แอดมิน|user|admin)\s*:\s*/i, '').trim();
      if (!cleanText) return;

      const catId = classifySentence(cleanText, chat.category_id);
      if (!topicMap[catId]) {
        topicMap[catId] = [];
      }
      topicMap[catId].push(cleanText);
    });

    if (Object.keys(topicMap).length === 0) {
      const catId = chat.category_id || 'other';
      topicMap[catId] = [chat.summary || chat.conversation.slice(0, 60)];
    }

    const issuesToInsert = Object.entries(topicMap).map(([catId, textList]) => {
      const priority = classifyPriority(catId);
      const department = classifyDepartment(catId);
      const reply = classifyRecommendedReply(catId);
      
      // Combine sentences of same topic into 1 clear issue summary
      let summaryText = textList[0];
      if (textList.length > 1) {
        summaryText = textList.slice(0, 3).join(' / ');
      }

      return {
        chat_id: chat.id,
        summary: summaryText,
        category_id: catId,
        priority: priority,
        department: department,
        recommended_reply: reply
      };
    });

    // Delete existing chat_issues for this chat
    await supabase.from('chat_issues').delete().eq('chat_id', chat.id);

    // Insert updated chat_issues
    const { error: insertErr } = await supabase.from('chat_issues').insert(issuesToInsert);
    if (insertErr) {
      console.error(`[${i+1}/${chats.length}] Error updating ${chat.id}:`, insertErr.message);
    } else {
      updatedCount++;
      if ((i + 1) % 50 === 0 || i === chats.length - 1) {
        console.log(`Progress: [${i+1}/${chats.length}] chats re-triaged successfully...`);
      }
    }
  }

  console.log('\n==================================================');
  console.log(`🎉 BULK RE-TRIAGE COMPLETED SUCCESSFULY!`);
  console.log(`   Total Processed: ${updatedCount} chats`);
  console.log(`   Skipped:         ${skippedCount} chats`);
  console.log('==================================================');
}

reTriageAllDatabaseChats().catch(console.error);
