/**
 * scripts/seedTodayChats.js
 * 
 * คัดลอกข้อมูลแชตเก่า 20 แชตจากเดือนก่อนๆ ที่นานแล้ว (กรกฎาคม - สิงหาคม 2569)
 * มาเป็นข้อมูลของ "วันนี้" (12 พฤศจิกายน 2569 / 2026-11-12)
 * พร้อมสร้างลูกค้าและประเด็นย่อยใน chat_issues ครบถ้วน เพื่อให้หน้า BO และบอทแสดงผลถูกต้อง
 */

import { supabase } from '../src/supabase.js';
import crypto from 'crypto';

const companyId = '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2';

async function seedTodayChats() {
  console.log('🚀 เริ่มต้นคัดลอกข้อมูลแชตเก่า 20 แชต สำหรับวันนี้ (12 พ.ย. 2569)...');

  // 1. ดึงแชตต้นแบบจากเดือนเก่าๆ (ก่อน 1 ต.ค. 2569) ที่มี chat_issues และบทสนทนาสมบูรณ์
  const { data: sourceChats, error: fetchErr } = await supabase
    .from('chats')
    .select('*, chat_issues(*)')
    .eq('company_id', companyId)
    .lt('created_at', '2026-10-01T00:00:00Z')
    .not('chat_issues', 'is', null)
    .order('created_at', { ascending: true })
    .limit(120);

  if (fetchErr || !sourceChats || sourceChats.length < 20) {
    console.error('❌ ไม่สามารถดึงข้อมูลแชตต้นแบบได้:', fetchErr?.message, 'Found:', sourceChats?.length);
    process.exit(1);
  }

  // เลือกแชตที่มี chat_issues สมบูรณ์แบบ Multi-issue (2-6 issues ต่อแชต) เพื่อให้สมจริง
  const validSources = sourceChats.filter(c => Array.isArray(c.chat_issues) && c.chat_issues.length >= 2);
  const selectedSources = validSources.slice(0, 20);
  console.log(`📋 คัดเลือกแชตต้นแบบ Multi-issue จากเดือนเก่าๆ มาได้ ${selectedSources.length} แชต`);

  // กำหนดเวลา 20 ช่วงเวลาตลอดทั้งวันนี้ (12 พ.ย. 2569) เวลาไทย (ICT / UTC+7)
  const timeSchedules = [
    { h: 8, m: 15, s: 20 },
    { h: 8, m: 45, s: 10 },
    { h: 9, m: 12, s: 45 },
    { h: 9, m: 38, s: 30 },
    { h: 10, m: 5, s: 15 },
    { h: 10, m: 40, s: 50 },
    { h: 11, m: 15, s: 22 },
    { h: 11, m: 50, s: 5 },
    { h: 12, m: 25, s: 35 },
    { h: 13, m: 5, s: 18 },
    { h: 13, m: 42, s: 40 },
    { h: 14, m: 10, s: 12 },
    { h: 14, m: 35, s: 55 },
    { h: 15, m: 8, s: 30 },
    { h: 15, m: 45, s: 14 },
    { h: 16, m: 15, s: 25 },
    { h: 16, m: 50, s: 40 },
    { h: 17, m: 10, s: 15 },
    { h: 17, m: 32, s: 50 },
    { h: 17, m: 48, s: 10 }
  ];

  const newCustomers = [];
  const newChats = [];
  const allNewIssues = [];

  for (let i = 0; i < selectedSources.length; i++) {
    const src = selectedSources[i];
    const numStr = String(i + 1).padStart(3, '0');
    const newChatId = `chat-nov12-${numStr}`;
    const newCustId = `cust-nov12-${numStr}`;
    const custName = src.customer_name || `Guest Customer (${newCustId})`;

    // คำนวณ ISO timestamp ในเขตเวลาไทยวันนี้ (2026-11-12)
    const t = timeSchedules[i];
    // UTC time = ICT - 7 hours
    const utcDate = new Date(Date.UTC(2026, 10, 12, t.h - 7, t.m, t.s));
    const createdAtStr = utcDate.toISOString();

    // ปรับการกระจาย priority และ sentiment ให้สมจริง
    let assignedPriority = src.priority || 'medium';
    let assignedSentiment = src.sentiment || 'ทั่วไป';

    if (i === 2 || i === 11) {
      assignedPriority = 'urgent';
      assignedSentiment = 'โกรธ';
    } else if (i === 4 || i === 8 || i === 15) {
      assignedPriority = 'high';
      assignedSentiment = 'ไม่พอใจ';
    } else if (i === 6 || i === 13) {
      assignedPriority = 'high';
      assignedSentiment = 'กังวล';
    } else if (i === 1 || i === 9 || i === 18) {
      assignedPriority = 'medium';
      assignedSentiment = 'พอใจ';
    }

    newCustomers.push({
      id: newCustId,
      name: custName,
      tier: (assignedPriority === 'urgent' || i === 7 || i === 17) ? 'VIP' : 'Regular',
      created_at: createdAtStr,
      company_id: companyId
    });

    const defaultReply = src.recommended_reply || 'เจ้าหน้าที่รับเรื่องและกำลังประสานงานตรวจสอบให้โดยด่วนค่ะ';

    const chatRow = {
      id: newChatId,
      customer_id: newCustId,
      customer_name: custName,
      conversation: src.conversation || '',
      status: 'completed',
      category_id: src.category_id,
      priority: assignedPriority,
      summary: src.summary || '',
      embedding: src.embedding || null,
      created_at: createdAtStr,
      company_id: companyId,
      sub_category: src.sub_category || null,
      intent: src.intent || null,
      root_cause: src.root_cause || null,
      sentiment: assignedSentiment,
      urgency: assignedPriority === 'urgent' ? 'immediate' : (assignedPriority === 'high' ? 'high' : 'normal'),
      department: src.department || 'support',
      keywords: Array.isArray(src.keywords) ? src.keywords : (src.keywords ? [src.keywords] : []),
      confidence: src.confidence || 0.95,
      recommended_reply: defaultReply,
      resolution: src.resolution || null,
      business_impact: src.business_impact || null,
      business_impact_score: src.business_impact_score || 5,
      ai_recommendation: src.ai_recommendation || null,
      tags: (assignedPriority === 'urgent') ? ['#URGENT', '#ESCALATE'] : (src.tags || ['#GENERAL']),
      is_test: false
    };
    newChats.push(chatRow);

    // สร้าง issues ย่อยใน chat_issues
    if (src.chat_issues && src.chat_issues.length > 0) {
      for (const iss of src.chat_issues) {
        allNewIssues.push({
          id: crypto.randomUUID(),
          chat_id: newChatId,
          category_id: iss.category_id || src.category_id,
          priority: iss.priority || assignedPriority,
          department: iss.department || src.department || 'support',
          summary: iss.summary || src.summary || '',
          recommended_reply: iss.recommended_reply || defaultReply,
          created_at: createdAtStr,
          is_human_verified: true
        });
      }
    } else {
      allNewIssues.push({
        id: crypto.randomUUID(),
        chat_id: newChatId,
        category_id: src.category_id,
        priority: assignedPriority,
        department: 'support',
        summary: src.summary || 'ประเด็นปัญหาของลูกค้า',
        recommended_reply: defaultReply,
        created_at: createdAtStr,
        is_human_verified: true
      });
    }
  }

  // 2. ลบข้อมูลเก่ากรณีเคยรัน seed ไว้ก่อนหน้าเพื่อป้องกัน duplicate key
  console.log('🧹 เคลียร์ข้อมูล seed เดิมของวันนี้ (ถ้ามี)...');
  const chatIds = newChats.map(c => c.id);
  const custIds = newCustomers.map(c => c.id);

  await supabase.from('chat_issues').delete().in('chat_id', chatIds);
  await supabase.from('chats').delete().in('id', chatIds);
  await supabase.from('customers').delete().in('id', custIds);

  // 3. Insert ข้อมูลใหม่เข้าสู่ Supabase
  console.log(`📥 กำลังบันทึกข้อมูลลูกค้าใหม่ ${newCustomers.length} ราย...`);
  const { error: custErr } = await supabase.from('customers').insert(newCustomers);
  if (custErr) {
    console.error('❌ ไม่สามารถบันทึก customers ได้:', custErr.message);
    process.exit(1);
  }

  console.log(`📥 กำลังบันทึกข้อมูลแชตใหม่ ${newChats.length} แชต...`);
  const { error: chatErr } = await supabase.from('chats').insert(newChats);
  if (chatErr) {
    console.error('❌ ไม่สามารถบันทึก chats ได้:', chatErr.message);
    process.exit(1);
  }

  console.log(`📥 กำลังบันทึกประเด็นปัญหา chat_issues จำนวน ${allNewIssues.length} รายการ...`);
  const { error: issErr } = await supabase.from('chat_issues').insert(allNewIssues);
  if (issErr) {
    console.error('❌ ไม่สามารถบันทึก chat_issues ได้:', issErr.message);
    process.exit(1);
  }

  console.log('🎉 บันทึกข้อมูลของวันนี้ (12 พ.ย. 2569) สำเร็จเรียบร้อยครบ 20 แชต!');
  console.log(`📊 สรุป: แชตทั้งหมด 20 รายการ, ประเด็นปัญหาทั้งหมด ${allNewIssues.length} รายการ`);
}

seedTodayChats().catch(console.error);
