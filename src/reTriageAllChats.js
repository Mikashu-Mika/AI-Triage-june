import { supabase, getCategories } from './supabase.js';
import { classifySentenceSemantic } from './triageService.js';


function classifyPriorityDynamic(catKey, catObj) {
  const text = (catKey + ' ' + (catObj?.name || '') + ' ' + (catObj?.description || '')).toLowerCase();
  if (text.includes('deposit') || text.includes('withdraw') || text.includes('การเงิน') || text.includes('ชำระเงิน') || text.includes('security') || text.includes('login') || text.includes('access_blocked') || text.includes('ความปลอดภัย') || text.includes('เข้าสู่ระบบ') || text.includes('ร้องเรียน')) {
    return 'high';
  }
  if (text.includes('promo') || text.includes('freeze') || text.includes('ค้าง') || text.includes('ช้า') || text.includes('lag') || text.includes('เพี้ยน') || text.includes('โบนัส')) {
    return 'medium';
  }
  return 'low';
}

function classifyDepartmentDynamic(catKey, catObj) {
  const text = (catKey + ' ' + (catObj?.name || '') + ' ' + (catObj?.description || '')).toLowerCase();
  if (text.includes('deposit') || text.includes('withdraw') || text.includes('การเงิน') || text.includes('ชำระเงิน') || text.includes('finance') || text.includes('payment')) {
    return 'Finance';
  }
  if (text.includes('promo') || text.includes('bonus') || text.includes('โบนัส') || text.includes('โปรโมชั่น') || text.includes('marketing')) {
    return 'Marketing';
  }
  if (text.includes('security') || text.includes('login') || text.includes('ความปลอดภัย') || text.includes('เข้าสู่ระบบ') || text.includes('notification') || text.includes('แจ้งเตือน')) {
    return 'Security';
  }
  if (text.includes('freeze') || text.includes('access') || text.includes('lag') || text.includes('ช้า') || text.includes('ค้าง') || text.includes('ui') || text.includes('technical') || text.includes('api') || text.includes('device') || text.includes('ระบบ')) {
    return 'Developer';
  }
  return 'Support';
}

function classifyRecommendedReplyDynamic(catKey, catObj) {
  const catName = catObj?.name || catKey;
  const text = (catKey + ' ' + (catObj?.name || '')).toLowerCase();
  if (text.includes('access') || text.includes('เข้าหน้าเว็บไม่ได้')) {
    return 'เจ้าหน้าที่กำลังเร่งประสานงานทีมเทคนิคและผู้ดูแลระบบเพื่อตรวจสอบการเข้าถึงระบบและสถานะเซิร์ฟเวอร์ด่วนค่ะ';
  }
  if (text.includes('deposit') || text.includes('withdraw') || text.includes('การเงิน') || text.includes('ชำระเงิน')) {
    return 'เจ้าหน้าที่กำลังประสานงานตรวจสอบยอดรายการชำระเงินให้ค่ะ รบกวนส่งสลิปหรือหลักฐานเพื่อความรวดเร็วในการตรวจสอบนะคะ';
  }
  if (text.includes('promo') || text.includes('โบนัส') || text.includes('โปรโมชั่น')) {
    return 'เจ้าหน้าที่กำลังตรวจสอบสิทธิ์โปรโมชั่นและข้อเสนอพิเศษให้ค่ะ';
  }
  if (text.includes('security') || text.includes('ความปลอดภัย') || text.includes('login') || text.includes('เข้าสู่ระบบ')) {
    return 'เจ้าหน้าที่กำลังตรวจสอบการเข้าสู่ระบบและความปลอดภัยของบัญชีให้ค่ะ';
  }
  return `เจ้าหน้าที่รับเรื่องเกี่ยวกับ "${catName}" เรียบร้อยและกำลังเร่งประสานงานตรวจสอบให้ค่ะ`;
}

export async function reTriageAllDatabaseChats() {
  console.log('Fetching ALL chats and categories from Supabase...');
  const categories = await getCategories();
  const { data: chats, error } = await supabase
    .from('chats')
    .select('id, category_id, company_id, conversation, summary');

  if (error || !chats) {
    console.error('Failed to fetch chats:', error?.message);
    process.exit(1);
  }

  console.log(`Found ${chats.length} total chats and ${categories.length} categories. Starting automated bulk Re-Triage...`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < chats.length; i++) {
    const chat = chats[i];
    if (!chat.conversation) {
      skippedCount++;
      continue;
    }

    const companyCategories = chat.company_id
      ? categories.filter(c => c.company_id === chat.company_id || !c.company_id)
      : categories;

    const sentences = chat.conversation
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (sentences.length === 0) {
      skippedCount++;
      continue;
    }

    // Group sentences by categorized issue topic using BGE-M3 vector semantic matching
    const topicMap = {};
    for (const rawText of sentences) {
      const cleanText = rawText.replace(/^(ลูกค้า|แอดมิน|พนักงาน|user|admin)\s*:\s*/i, '').trim();
      if (!cleanText) continue;

      const semanticMatch = await classifySentenceSemantic(cleanText, companyCategories, chat.category_id);
      const catId = semanticMatch.category_id || chat.category_id || 'other';
      if (!topicMap[catId]) {
        topicMap[catId] = [];
      }
      topicMap[catId].push(cleanText);
    }

    if (Object.keys(topicMap).length === 0) {
      const catId = chat.category_id || 'other';
      topicMap[catId] = [chat.summary || chat.conversation.slice(0, 60)];
    }

    const issuesToInsert = Object.entries(topicMap).map(([catId, textList]) => {
      const matchedCat = companyCategories.find(c => c.id === catId || c.id.endsWith(':' + catId));
      const cleanCatKey = catId.includes(':') ? catId.split(':')[1] : catId;

      const priority = classifyPriorityDynamic(cleanCatKey, matchedCat);
      const department = classifyDepartmentDynamic(cleanCatKey, matchedCat);
      const reply = classifyRecommendedReplyDynamic(cleanCatKey, matchedCat);
      
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

// Run directly if called as a script
if (process.argv[1] && process.argv[1].endsWith('reTriageAllChats.js')) {
  reTriageAllDatabaseChats().catch(console.error);
}
