import { supabase } from '../src/supabase.js';

async function fixChat10169() {
  console.log('Fixing chat-10169 classification in Supabase...');

  const { data: chat, error: fetchErr } = await supabase
    .from('chats')
    .select('*')
    .eq('id', 'chat-10169')
    .single();

  if (fetchErr || !chat) {
    console.error('Error fetching chat-10169:', fetchErr);
    process.exit(1);
  }

  const convLines = (chat.conversation || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const issuesToInsert = [];

  convLines.forEach(line => {
    const cleanLine = line.replace(/^(ลูกค้า|แอดมิน|user|admin)\s*:\s*/i, '').trim();
    if (!cleanLine) return;

    const lower = cleanLine.toLowerCase();
    let catId = 'login_issue';
    let priority = 'high';

    if (lower.includes('otp')) {
      catId = 'notification_issue';
      priority = 'medium';
    }

    issuesToInsert.push({
      chat_id: chat.id,
      summary: cleanLine,
      category_id: catId,
      priority: priority,
      department: 'Support',
      recommended_reply: `สวัสดีค่ะ ทีมงานกำลังดำเนินการตรวจสอบปัญหา "${cleanLine}" ให้คุณลูกค้าโดยเร็วที่สุดค่ะ`
    });
  });

  // Delete existing broken issues for chat-10169
  await supabase.from('chat_issues').delete().eq('chat_id', 'chat-10169');

  // Insert corrected issues
  const { error: insertErr } = await supabase.from('chat_issues').insert(issuesToInsert);
  if (insertErr) {
    console.error('Error inserting corrected chat_issues:', insertErr);
  } else {
    console.log('✅ Successfully updated chat_issues for chat-10169 in Supabase!');
  }

  const { data: updated } = await supabase
    .from('chats')
    .select('*, chat_issues(*)')
    .eq('id', 'chat-10169')
    .single();

  console.log('New Breakdown for chat-10169:');
  updated.chat_issues.forEach((iss, idx) => {
    console.log(` #${idx + 1} "${iss.summary}" -> ${iss.category_id} (${iss.priority})`);
  });

  process.exit(0);
}

fixChat10169();
