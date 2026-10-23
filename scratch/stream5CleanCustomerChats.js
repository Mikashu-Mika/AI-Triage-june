import dotenv from 'dotenv';
import { supabase } from '../src/supabase.js';
import { processSingleChat } from '../src/triageService.js';
import { getCachedCategories, getCategoryDisplayName } from '../src/categoryHelper.js';

dotenv.config();

const COMPANY_ID = '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2'; // Mika Co.
const DELAY_SECONDS = 45; // 45 seconds between problems for smooth sequential processing

const cleanCustomerChats = [
  {
    id: 'chat-customer-011',
    customer_id: 'cust-111',
    customer_name: 'คุณณัฐพล (ลูกค้าทั่วไป)',
    conversation: [
      'ลูกค้า: สวัสดีครับ สั่งซื้อชุดโต๊ะทำงานและอุปกรณ์ไปเมื่อช่วงเที่ยงครับ',
      'ลูกค้า: ชำระเงินผ่านการโอนแล้ว มีสลิปหักเงินในบัญชี 3,200 บาทเรียบร้อยครับ',
      'ลูกค้า: แต่ในระบบหน้ารายการสั่งซื้อยังขึ้นสถานะว่ารอชำระเงินอยู่เลยครับ',
      'ลูกค้า: ยอดเงินไม่ยอมปรับอัตโนมัติให้ครับ',
      'ลูกค้า: พอกดแนบสลิปในเว็บ หน้าต่างอัปโหลดก็หมุนค้างไม่ยอมให้ส่งไฟล์ครับ',
      'ลูกค้า: รบกวนช่วยตรวจสอบยอดเงินและอัปเดตคำสั่งซื้อให้ด้วยนะครับ'
    ].join('\n')
  },
  {
    id: 'chat-customer-012',
    customer_id: 'cust-112',
    customer_name: 'คุณพิมพ์มาดา (ลูกค้าทั่วไป)',
    conversation: [
      'ลูกค้า: สวัสดีค่ะ กำลังเปิดเลือกซื้อเสื้อผ้าในเว็บไซต์ผ่านมือถือค่ะ',
      'ลูกค้า: แต่รูปภาพสินค้าหลายรูปไม่ยอมโหลดขึ้นมาเลยค่ะ กลายเป็นกล่องสี่เหลี่ยมสีเทาว่างๆ',
      'ลูกค้า: ตัวหนังสือชื่อสินค้ากับราคาโปรโมชั่นก็เลื่อนมาซ้อนทับกันจนอ่านไม่รู้เรื่องค่ะ',
      'ลูกค้า: พอกดเลือกไซซ์หรือเปลี่ยนสี ปุ่มค้างนิ่งไปเกือบสิบวินาทีกว่าจะตอบสนองค่ะ',
      'ลูกค้า: ลองรีเฟรชหน้าเว็บหลายรอบแล้วก็ยังเป็นเหมือนเดิม ช่วยแก้ไขการแสดงผลด้วยนะคะ'
    ].join('\n')
  },
  {
    id: 'chat-customer-013',
    customer_id: 'cust-113',
    customer_name: 'คุณธนกร (ลูกค้าทั่วไป)',
    conversation: [
      'ลูกค้า: สวัสดีครับ เข้าสู่ระบบบัญชีของตัวเองไม่ได้ตั้งแต่ช่วงบ่ายครับ',
      'ลูกค้า: ระบบแจ้งว่ารหัสผ่านไม่ถูกต้อง ทั้งที่ผมใช้รหัสเดิมมาตลอดครับ',
      'ลูกค้า: พอกดลืมรหัสผ่านเพื่อขอตั้งรหัสใหม่ ก็ไม่มีรหัส OTP ส่งเข้ามาที่ SMS เบอร์โทรศัพท์เลยครับ',
      'ลูกค้า: ลองกดส่งใหม่ซ้ำอีก 3 รอบก็ยังไม่ได้รับข้อความ OTP เลยสักรอบครับ',
      'ลูกค้า: กลัวว่าบัญชีจะมีความเสี่ยงหรือถูกคนอื่นเปลี่ยนข้อมูล ช่วยตรวจสอบความปลอดภัยให้ทีครับ'
    ].join('\n')
  },
  {
    id: 'chat-customer-014',
    customer_id: 'cust-114',
    customer_name: 'คุณสุพรรษา (ลูกค้าทั่วไป)',
    conversation: [
      'ลูกค้า: สวัสดีค่ะ มีข้อสงสัยเรื่องโปรโมชั่นและแต้มสะสมค่ะ',
      'ลูกค้า: มียอดสั่งซื้อสะสมครบ 5,000 บาท ตามเงื่อนไขโปรโมชั่นสะสมยอดของเดือนนี้แล้วค่ะ',
      'ลูกค้า: ตามเงื่อนไขในระบบแจ้งว่าจะได้รับคูปองส่วนลด 500 บาทและแต้มสะสมพิเศษ 200 คะแนนค่ะ',
      'ลูกค้า: แต่พอเข้าไปเช็กในหน้าคูปองของฉันกลับไม่ได้รับคูปองเลยค่ะ',
      'ลูกค้า: แต้มสะสมก็ยังไม่ปรับเพิ่มขึ้นให้ด้วย ช่วยตรวจสอบและมอบสิทธิ์โปรโมชั่นให้ด้วยนะคะ'
    ].join('\n')
  },
  {
    id: 'chat-customer-015',
    customer_id: 'cust-115',
    customer_name: 'คุณกิตติศักดิ์ (ลูกค้าทั่วไป)',
    conversation: [
      'ลูกค้า: รบกวนทีมงานตรวจสอบระบบเว็บไซต์ด่วนครับ',
      'ลูกค้า: กำลังจะกดทำรายการยืนยันคำสั่งซื้อ หน้าเว็บก็ค้างหมุนอยู่นานมาก',
      'ลูกค้า: แล้วจู่ๆ หน้าจอก็กลายเป็นสีขาว เด้งข้อความแจ้งเตือน Error 502 Bad Gateway ขึ้นมาครับ',
      'ลูกค้า: พอลองกดรีเฟรชหรือเข้าลิงก์หน้าหลักใหม่ ก็ขึ้นแจ้งเตือนว่า Service Unavailable เข้าไม่ได้เลยครับ',
      'ลูกค้า: ระบบเซิร์ฟเวอร์น่าจะมีปัญหาขัดข้อง รบกวนช่วยเร่งตรวจสอบและกู้คืนระบบให้ทีครับ'
    ].join('\n')
  }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runStreamPipeline() {
  console.log('===============================================================');
  console.log('🚀 เริ่มต้นทดสอบส่งชุดปัญหาลูกค้า 5 ชุด (ทยอยส่งทีละชุดอย่างเป็นขั้นตอน)');
  console.log(`🏢 บริษัทเป้าหมาย: Mika Co. (${COMPANY_ID})`);
  console.log(`⏱️ ระยะห่างระหว่างปัญหา: ${DELAY_SECONDS} วินาที`);
  console.log('===============================================================\n');

  const categories = await getCachedCategories(COMPANY_ID);

  // 1. Ensure customers exist in database
  for (const c of cleanCustomerChats) {
    await supabase.from('customers').upsert({
      id: c.customer_id,
      name: c.customer_name,
      phone: null,
      email: null
    });
  }

  const resultsSummary = [];

  for (let i = 0; i < cleanCustomerChats.length; i++) {
    const item = cleanCustomerChats[i];
    const timestamp = new Date().toLocaleTimeString('th-TH');
    const startOverall = Date.now();

    console.log(`\n---------------------------------------------------------------`);
    console.log(`[${timestamp}] 📩 กำลังส่งชุดปัญหาที่ ${i + 1}/5: "${item.id}" (${item.customer_name})`);
    console.log(`📄 เนื้อหาการแจ้งปัญหา:\n${item.conversation.split('\n').map(l => '   ' + l).join('\n')}`);

    // Insert as pending
    const { error: insErr } = await supabase.from('chats').upsert({
      id: item.id,
      customer_id: item.customer_id,
      company_id: COMPANY_ID,
      conversation: item.conversation,
      status: 'pending'
    });

    if (insErr) {
      console.error(`❌ บันทึกแชต ${item.id} ลง Supabase ล้มเหลว:`, insErr.message);
      continue;
    }
    console.log(`✅ บันทึกสถานะ Pending ลง Supabase เรียบร้อย`);

    // Run AI Triage through Ollama (Qwen 2.5 14B + BGE-M3 Dynamic Vector Matching)
    console.log(`🤖 กำลังประมวลผลด้วย AI Triage (Qwen 2.5 14B + BGE-M3 Vector Embedding)...`);
    const triageStart = Date.now();
    try {
      await processSingleChat(item.id);
      const triageDuration = ((Date.now() - triageStart) / 1000).toFixed(1);
      console.log(`✅ AI วิเคราะห์และบันทึกผลสำเร็จใน ${triageDuration} วินาที!`);

      // Query result from Supabase to log summary
      const { data: result } = await supabase
        .from('chats')
        .select('category_id, priority, department, summary, recommended_reply, chat_issues(*)')
        .eq('id', item.id)
        .single();

      const mainCatDisplayName = getCategoryDisplayName(result?.category_id, categories);

      console.log(`   📌 หมวดหลัก: ${result?.category_id} ("${mainCatDisplayName}")`);
      console.log(`   ⚡ แผนกรับผิดชอบ: ${result?.department} | ระดับความเร่งด่วน: ${result?.priority}`);
      console.log(`   📝 สรุปสาระสำคัญ: ${result?.summary}`);
      console.log(`   💬 ข้อความตอบกลับที่แนะนำ: "${result?.recommended_reply}"`);
      console.log(`   🔍 ประเด็นย่อยใน chat_issues (${result?.chat_issues?.length || 0} เรื่อง):`);
      
      const issuesList = [];
      result?.chat_issues?.forEach((iss, idx) => {
        const issCatName = getCategoryDisplayName(iss.category_id, categories);
        console.log(`      ${idx + 1}. [${iss.category_id} - ${issCatName}] (${iss.priority}): "${iss.summary}"`);
        issuesList.push({
          category_id: iss.category_id,
          category_name: issCatName,
          priority: iss.priority,
          summary: iss.summary
        });
      });

      resultsSummary.push({
        id: item.id,
        customer_name: item.customer_name,
        category_id: result?.category_id,
        category_name: mainCatDisplayName,
        priority: result?.priority,
        department: result?.department,
        summary: result?.summary,
        issues: issuesList,
        duration: triageDuration
      });

    } catch (err) {
      console.error(`❌ การวิเคราะห์สำหรับ ${item.id} ขัดข้อง:`, err.message);
    }

    // Wait before sending the next one if not last
    if (i < cleanCustomerChats.length - 1) {
      const elapsedSeconds = Math.round((Date.now() - startOverall) / 1000);
      const remainingSeconds = Math.max(0, DELAY_SECONDS - elapsedSeconds);
      console.log(`\n⏳ เว้นระยะห่าง ${remainingSeconds} วินาที เพื่อให้ระบบจัดการเสร็จสมบูรณ์ ก่อนส่งปัญหาชุดที่ ${i + 2}...`);
      await sleep(remainingSeconds * 1000);
    }
  }

  console.log('\n===============================================================');
  console.log('🎉 ทยอยส่งและวิเคราะห์ชุดปัญหาครบทั้ง 5 ชุดเรียบร้อยสมบูรณ์แล้ว!');
  console.log('===============================================================');
  console.log('\n📊 สรุปผลลัพธ์ทั้ง 5 ชุด:');
  resultsSummary.forEach((r, idx) => {
    console.log(`${idx + 1}. [${r.id}] ${r.customer_name}`);
    console.log(`   หมวดหลัก: ${r.category_name} (${r.category_id}) | แผนก: ${r.department} | ด่วน: ${r.priority} (${r.duration}s)`);
    console.log(`   สรุป: ${r.summary}`);
    console.log(`   ประเด็นย่อย: ${r.issues.map(i => `${i.category_name} (${i.summary})`).join(' | ')}`);
  });
}

runStreamPipeline().catch(console.error);
