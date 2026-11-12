/**
 * scripts/seedYesterdayChats.js
 * 
 * คัดลอกข้อมูลแชตเก่า 15 แชตมาเป็นข้อมูลของ "เมื่อวาน" (11 พฤศจิกายน 2569 / 2026-11-11)
 * พร้อมสร้างลูกค้าและประเด็นย่อยใน chat_issues ครบถ้วน
 */

import { supabase } from '../src/supabase.js';
import crypto from 'crypto';

const companyId = '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2';

async function seedYesterdayChats() {
  console.log('🚀 เริ่มต้นคัดลอกข้อมูลแชต 15 แชตสำหรับเมื่อวาน (11 พ.ย. 2569)...');

  // 1. ดึง 15 แชตต้นแบบที่มี chat_issues สมบูรณ์
  const { data: sourceChats, error: fetchErr } = await supabase
    .from('chats')
    .select('*, chat_issues(*)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (fetchErr || !sourceChats || sourceChats.length < 15) {
    console.error('❌ ไม่สามารถดึงข้อมูลแชตต้นแบบได้:', fetchErr?.message);
    process.exit(1);
  }

  // เลือก 15 แชตแรกที่สมบูรณ์
  const selectedSources = sourceChats.slice(0, 15);
  console.log(`📋 เลือกแชตต้นแบบมาได้ ${selectedSources.length} แชต`);

  // กำหนดช่วงเวลาเมื่อวาน (11 พ.ย. 2569) ในเวลาไทย (UTC+7)
  // 08:30, 09:15, 10:20, 11:05, 11:45, 13:10, 14:15, 15:30, 16:10, 16:45, 17:20, 18:00, 19:15, 20:30, 21:15
  const timeHours = [
    { h: 8, m: 30, s: 12 },
    { h: 9, m: 15, s: 45 },
    { h: 10, m: 20, s: 30 },
    { h: 11, m: 5, s: 18 },
    { h: 11, m: 45, s: 50 },
    { h: 13, m: 10, s: 22 },
    { h: 14, m: 15, s: 40 },
    { h: 15, m: 30, s: 15 },
    { h: 16, m: 10, s: 5 },
    { h: 16, m: 45, s: 33 },
    { h: 17, m: 20, s: 10 },
    { h: 18, m: 0, s: 48 },
    { h: 19, m: 15, s: 25 },
    { h: 20, m: 30, s: 14 },
    { h: 21, m: 15, s: 55 }
  ];

  const newCustomers = [];
  const newChats = [];
  const allNewIssues = [];

  for (let i = 0; i < selectedSources.length; i++) {
    const src = selectedSources[i];
    const numStr = String(i + 1).padStart(3, '0');
    const newChatId = `chat-nov11-${numStr}`;
    const newCustId = `cust-nov11-${numStr}`;
    const custName = `Guest Customer (${newCustId})`;

    // คำนวณ ISO timestamp ในเขตเวลาไทยเมื่อวาน (2026-11-11)
    const t = timeHours[i];
    // UTC time = ICT - 7 hours
    const utcDate = new Date(Date.UTC(2026, 10, 11, t.h - 7, t.m, t.s));
    const createdAtStr = utcDate.toISOString();

    // ปรับ sentiment ให้หลากหลายและมีเคสโกรธ/ไม่พอใจสำหรับสรุปเช้า
    let assignedSentiment = src.sentiment || 'ทั่วไป';
    let assignedPriority = src.priority || 'medium';

    if (i === 1 || i === 8) {
      assignedPriority = 'urgent';
      assignedSentiment = 'โกรธ';
    } else if (i === 3 || i === 9 || i === 13) {
      assignedPriority = 'high';
      assignedSentiment = 'ไม่พอใจ';
    } else if (i === 5 || i === 11) {
      assignedPriority = 'high';
      assignedSentiment = 'ทั่วไป';
    } else if (i === 7 || i === 14) {
      assignedPriority = 'medium';
      assignedSentiment = 'พอใจ';
    }

    newCustomers.push({
      id: newCustId,
      name: custName,
      tier: (i === 1 || i === 8 || i === 11) ? 'VIP' : 'Regular',
      created_at: createdAtStr,
      company_id: companyId
    });

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
      keywords: src.keywords || [],
      confidence: src.confidence || 0.95,
      recommended_reply: src.recommended_reply || null,
      resolution: src.resolution || null,
      business_impact: src.business_impact || null,
      business_impact_score: src.business_impact_score || 5,
      ai_recommendation: src.ai_recommendation || null,
      tags: (assignedPriority === 'urgent') ? ['#URGENT', '#ESCALATE'] : (src.tags || ['#GENERAL']),
      is_test: false
    };
    newChats.push(chatRow);

    // คัดลอก chat_issues
    const defaultReply = chatRow.recommended_reply || 'เจ้าหน้าที่รับเรื่องและกำลังประสานงานตรวจสอบให้โดยด่วนค่ะ';
    const srcIssues = src.chat_issues || [];
    if (srcIssues.length > 0) {
      srcIssues.forEach((iss) => {
        allNewIssues.push({
          id: crypto.randomUUID(),
          chat_id: newChatId,
          category_id: iss.category_id,
          priority: iss.priority || assignedPriority,
          department: iss.department || 'support',
          summary: iss.summary || chatRow.summary,
          recommended_reply: iss.recommended_reply || defaultReply,
          created_at: createdAtStr,
          is_human_verified: true
        });
      });
    } else {
      // ถ้าไม่มี issue ย่อย ให้สร้าง 1 issue หลักตามหมวดหมู่ของแชต
      allNewIssues.push({
        id: crypto.randomUUID(),
        chat_id: newChatId,
        category_id: src.category_id,
        priority: assignedPriority,
        department: 'support',
        summary: chatRow.summary,
        recommended_reply: defaultReply,
        created_at: createdAtStr,
        is_human_verified: true
      });
    }
  }

  // 2. บันทึกลง Supabase
  console.log(`👤 บันทึกข้อมูลลูกค้า ${newCustomers.length} คน...`);
  const { error: custErr } = await supabase.from('customers').upsert(newCustomers);
  if (custErr) console.warn('⚠️ Warning upserting customers:', custErr.message);

  console.log(`💬 บันทึกข้อมูลแชต ${newChats.length} แชต...`);
  const { error: chatErr } = await supabase.from('chats').upsert(newChats);
  if (chatErr) {
    console.error('❌ ไม่สามารถบันทึก chats ได้:', chatErr.message);
    process.exit(1);
  }

  console.log(`🏷️ บันทึกประเด็นปัญหา (chat_issues) ${allNewIssues.length} รายการ...`);
  const { error: issueErr } = await supabase.from('chat_issues').upsert(allNewIssues);
  if (issueErr) {
    console.error('❌ ไม่สามารถบันทึก chat_issues ได้:', issueErr.message);
    process.exit(1);
  }

  console.log('\n============================================================');
  console.log('✅ จำลองข้อมูลแชตของเมื่อวาน (11 พ.ย. 2569) สำเร็จเรียบร้อย!');
  console.log(`📊 จำนวนแชต: ${newChats.length} แชต`);
  console.log(`📌 จำนวนประเด็นปัญหาทั้งหมด: ${allNewIssues.length} ปัญหา`);
  console.log('============================================================\n');
}

seedYesterdayChats().catch(console.error);
