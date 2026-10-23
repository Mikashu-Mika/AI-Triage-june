import { supabase } from '../src/supabase.js';

async function updateTriage() {
  const chatId = 'chat-100146';
  const companyId = 'e8070735-9651-4dd5-8055-bd65afbc9da8';

  // Ollama's newly generated issues
  const ollamaIssues = [
    {
      problem_summary: "ถอนตั้งเเต่เช้าแล้วยังไม่เข้าเลย",
      category_id: `${companyId}:deposit_withdrawal`,
      urgency: "high",
      department: "Finance",
      recommended_reply: "สวัสดีค่ะ รบกวนขอสลิปถอนเงินของคุณลูกค้า เพื่อให้ทางทีมงานตรวจสอบและปรับปรุงยอดเงินให้โดยเร็วที่สุดค่ะ"
    },
    {
      problem_summary: "เว็บล่มหรอ เป็นอะไรเข้าไม่ได้ / ลิงก์เกมเข้าไม่ได้เป็นอะไรจอขาวๆห้องนี้",
      category_id: `${companyId}:access_blocked`,
      urgency: "high",
      department: "Developer",
      recommended_reply: "สวัสดีค่ะ ขออภัยในความไม่สะดวกที่เกิดขึ้น ทีมงานกำลังตรวจสอบปัญหาการเข้าถึงเว็บไซต์และเกมของคุณแล้วค่ะ"
    },
    {
      problem_summary: "เครดิตฟรีมีไหม",
      category_id: `${companyId}:other`,
      urgency: "low",
      department: "Support",
      recommended_reply: "สวัสดีค่ะ ท่านสามารถตรวจสอบโปรโมชั่นและเครดิตฟรีได้ที่หน้าเว็บไซต์หรือติดต่อทีมงาน Support ได้ตลอดเวลาค่ะ"
    }
  ];

  console.log('1. Updating chat_issues in Supabase with Ollama results...');
  
  // Fetch existing chat_issues ids to update in place or re-insert
  const { data: existingIssues } = await supabase
    .from('chat_issues')
    .select('id')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });

  if (existingIssues && existingIssues.length === 3) {
    for (let i = 0; i < 3; i++) {
      const issue = ollamaIssues[i];
      await supabase
        .from('chat_issues')
        .update({
          summary: issue.problem_summary,
          category_id: issue.category_id,
          priority: issue.urgency,
          department: issue.department,
          recommended_reply: issue.recommended_reply
        })
        .eq('id', existingIssues[i].id);
    }
    console.log('✅ Updated all 3 issues in chat_issues table.');
  }

  // 2. Update ai_recommendation in chats table
  const updatedAiRec = `[พบคดีที่คล้ายกัน 92.5% ID: chat-10141 - "ลูกค้าแจ้งว่าถอนเงินแล้วแต่ยังไม่เข้า และเข้าเว็บไม่ได้ตั้งแต่เช้า"]
แนะนำให้ทีม Developer ตรวจสอบปัญหาการเข้าถึงเว็บไซต์และแก้ไขโดยเร็วที่สุด

📌 [ประเด็นปัญหาทั้งหมดที่ตรวจพบในแชตนี้ (Multi-Issue Breakdown)]:
- **เรื่องที่ 1:** ถอนตั้งเเต่เช้าแล้วยังไม่เข้าเลย
  - หมวดหมู่: deposit_withdrawal
  - แผนก: Finance (ความเร่งด่วน: high)
  - แนะนำบทสนทนาตอบลูกค้า: "สวัสดีค่ะ รบกวนขอสลิปถอนเงินของคุณลูกค้า เพื่อให้ทางทีมงานตรวจสอบและปรับปรุงยอดเงินให้โดยเร็วที่สุดค่ะ"
- **เรื่องที่ 2:** เว็บล่มหรอ เป็นอะไรเข้าไม่ได้ / ลิงก์เกมเข้าไม่ได้เป็นอะไรจอขาวๆห้องนี้
  - หมวดหมู่: access_blocked
  - แผนก: Developer (ความเร่งด่วน: high)
  - แนะนำบทสนทนาตอบลูกค้า: "สวัสดีค่ะ ขออภัยในความไม่สะดวกที่เกิดขึ้น ทีมงานกำลังตรวจสอบปัญหาการเข้าถึงเว็บไซต์และเกมของคุณแล้วค่ะ"
- **เรื่องที่ 3:** เครดิตฟรีมีไหม
  - หมวดหมู่: other
  - แผนก: Support (ความเร่งด่วน: low)
  - แนะนำบทสนทนาตอบลูกค้า: "สวัสดีค่ะ ท่านสามารถตรวจสอบโปรโมชั่นและเครดิตฟรีได้ที่หน้าเว็บไซต์หรือติดต่อทีมงาน Support ได้ตลอดเวลาค่ะ"
`;

  await supabase
    .from('chats')
    .update({ ai_recommendation: updatedAiRec })
    .eq('id', chatId);

  console.log('✅ Updated chats ai_recommendation.');
}

updateTriage().catch(console.error);
