import { supabase } from './supabase.js';
import fetch from 'node-fetch';

const testPayloads = [
  // Round 1
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: สวัสดีค่ะแอดมิน วันนี้มีโปรโมชั่นอะไรเด็ดๆ แนะนำไหมคะ อยากลองเล่นดูค่ะ พอดีเป็นสมาชิกใหม่"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: ขอบัญชีธนาคารสำหรับโอนเงินหน่อยค่ะ พอดีหาเลขบัญชีหน้าเว็บไม่เจอ แอดมินขอเลขกสิกรไทยหน่อยค่ะ"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: แอดมินช่วยด้วยค่ะ เข้าเกมไม่ได้ เกมค้างหน้าโหลด 99% แล้วเด้งออกตลอด ลองสลับเน็ตแล้วก็ไม่หาย"
    ]
  },

  // Round 2
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: สอบถามวิธีแนะนำเพื่อนหน่อยครับ ชวนเพื่อนมาเล่นจะได้ค่าคอมมิชชั่นหรือโบนัสกี่ % ครับ"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: โอนเงินฝากเข้ามาระบบแจ้งปรับยอดออโต้สำเร็จแล้ว แต่ทำไมยอดเครดิตในเกมยังไม่ขึ้นครับ ช่วยเช็กสลิปหน่อย"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: แอดมินบริการดีมากครับ ช่วยเหลือไวมาก ประทับใจมากเลย ขอบคุณมากๆ นะครับ"
    ]
  },

  // Round 3
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: สอบถามข้อมูลเปิดปิดระบบถอนเงินค่ะ สามารถกดถอนเงินผ่านหน้าเว็บได้ตลอด 24 ชั่วโมงเลยไหมคะ"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: ลืมรหัสผ่านเข้าสู่ระบบครับ กดลืมรหัสผ่านแล้วแต่รหัส OTP ไม่ส่งมาที่เบอร์โทรศัพท์"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: สวัสดีครับ มีเกมไหนแจ็กพอตแตกง่ายแนะนำสำหรับมือใหม่บ้างครับ อยากลองเริ่มเล่นดู"
    ]
  },

  // Round 4
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: ขอเปลี่ยนเลขบัญชีธนาคารรับเงินถอนหน่อยครับ บัญชีเดิมยกเลิกไปแล้ว ต้องใช้เอกสารอะไรบ้างครับ"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: หน้าเว็บโหลดค้างจอดำหมุนไม่หยุดเลยค่ะ เข้าผ่าน Safari บน iPhone 15 ค้างเหมือนกันทุกเครื่อง"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: ได้รับโบนัสยอดฝากประจำวันเรียบร้อยแล้วนะคะ ขอบคุณแอดมินมากค่ะ แนะนำดีมากเลย"
    ]
  },

  // Round 5
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: สอบถามวิธีสมัครสมาชิกค่ะ พอดีจะสมัครให้เพื่อน ต้องเตรียมข้อมูลอะไรบ้างคะ มีขั้นต่ำไหม"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: แอดมินช่วยด้วยค่ะ มีคนแอบเอาบัญชีไปล็อกอินเครื่องอื่นแล้วเปลี่ยนรหัสผ่าน ตอนนี้เข้าเล่นไม่ได้เลย"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: ระบบหน้าเว็บโฉมใหม่สวยงามและใช้งานง่ายขึ้นเยอะเลยครับ ขอชมเชยทีมงานครับ"
    ]
  },

  // Round 6
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: สอบถามเงื่อนไขระดับสมาชิก VIP ครับ ต้องสะสมยอดเล่นเท่าไหร่ถึงจะได้ปรับระดับขึ้น VIP ครับ"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: สแกน QR Code ชำระเงินฝากแล้วยอดเงินตัดจากธนาคารแล้ว แต่หน้าเว็บขึ้น Gateway Timeout"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: สวัสดีค่ะ แวะมาทักทายแอดมิน ขอให้วันนี้เป็นวันที่ดีและออเดอร์ปังๆ นะคะ"
    ]
  },

  // Round 7
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: ถ้าอยากเปลี่ยนภาษาในหน้าเว็บไซต์จากภาษาอังกฤษเป็นภาษาไทย ต้องกดตรงไหนเหรอครับ"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: เติมเงินเข้าระบบตามเงื่อนไขโปรโมชั่นฝากแรกของวันแล้ว แต่กดรับโบนัสฟรีเครดิตไม่ขึ้นครับ"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: สอบถามว่าถ้าถอนเงินเข้าบัญชีทรูวอลเล็ท มีค่าธรรมเนียมการถอนไหมครับ"
    ]
  },

  // Round 8
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: สอบถามช่องทางการติดต่อสำรองกรณีหน้าเว็บเข้าไม่ได้ มีช่องทาง Telegram หรือ Line สำรองไหมครับ"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: กดปุ่มยืนยันการสมัครสมาชิกแล้วหน้าจอขึ้นว่าเบอร์โทรศัพท์นี้ถูกใช้งานแล้ว ทั้งที่ไม่เคยสมัครมาก่อน"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: ระบบฝากถอนออโต้ทำงานไวมากเลยครับ รวดเร็วทันใจมาก ขอบคุณครับ"
    ]
  },

  // Round 9
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: สอบถามเรื่องกิจกรรมสุ่มแจกของรางวัลปลายเดือนนี้ครับ ร่วมสนุกยังไงบ้างครับ"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: เล่นเกมสล็อตอยู่แล้วจู่ๆ เกมเด้งหลุด เงินเดิมพันในรอบนั้นถูกหักไปแต่ผลเกมไม่แสดง ช่วยตรวจสอบด้วย"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: แอดมินตอบแชตสุภาพและอธิบายละเอียดดีมากครับ ยอดเยี่ยมมากๆ"
    ]
  },

  // Round 10
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: ขอสอบถามว่ารองรับการฝากเงินผ่านธนาคารไหนบ้างครับ พอดีมีบัญชีธนาคารกรุงไทย"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: หน้าเว็บไซต์แสดงผลตัวหนังสือซ้อนกันบนแท็บเล็ต iPad Pro ปุ่มกดถอนเงินทับกับเมนูหลัก"
    ]
  },
  {
    customer_id: "cust-003",
    conversation: [
      "ลูกค้า: ได้รับของขวัญพิเศษประจำเทศกาลแล้วนะครับ ขอบคุณทีมงานและบริษัทมากครับ"
    ]
  }
];

async function run() {
  console.log('================================================================');
  console.log('🧪 Scheduled Multi-Round AI Triage Testing Suite (With Non-Issues)');
  console.log('================================================================');
  console.log('- Total Rounds: 10');
  console.log('- Chats per Round: 3 (Spaced 1 minute apart)');
  console.log('- Total test chats: 30 chats (includes 15 Non-Issue General Inquiries)');

  // 1. Fetch credentials
  const { data: company, error: credError } = await supabase
    .from('companies')
    .select('client_id, client_secret')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (credError || !company) {
    console.error('❌ Failed to fetch credentials:', credError ? credError.message : 'No company found');
    return;
  }
  console.log(`✅ Loaded Client ID: ${company.client_id}`);

  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const runPrefix = `round-${day}${hours}${minutes}`;

  const roundPayloads = testPayloads.map((p, index) => {
    const roundIndex = String(index + 1).padStart(3, '0');
    return {
      id: `${runPrefix}-${roundIndex}`,
      customer_id: p.customer_id,
      conversation: p.conversation
    };
  });

  // 2. Process 10 rounds
  for (let r = 1; r <= 10; r++) {
    const startIdx = (r - 1) * 3;
    const roundChats = roundPayloads.slice(startIdx, startIdx + 3);

    console.log(`\n================================================================`);
    console.log(`📦 ROUND ${r}/10 | Starting Ingestion`);
    console.log(`================================================================`);

    // Ingest 3 chats, 1 minute apart
    for (let c = 0; c < roundChats.length; c++) {
      const chat = roundChats[c];
      const timeStr = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      console.log(`[${timeStr}] Ingesting ${chat.id} (Item ${c + 1}/3 of Round ${r})`);
      
      try {
        const res = await fetch('http://localhost:4000/api/chats/ingest', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-client-id': company.client_id,
            'x-client-secret': company.client_secret
          },
          body: JSON.stringify({
            id: chat.id,
            customer_id: chat.customer_id,
            conversation: chat.conversation
          })
        });

        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || res.statusText);
        }
        console.log(`  ✅ ${chat.id} ingested successfully!`);
      } catch (err) {
        console.error(`  ❌ Failed to ingest ${chat.id}:`, err.message);
      }

      // Space ingestion by 1 minute (60 seconds)
      if (c < roundChats.length - 1) {
        console.log('  💤 Waiting 60 seconds before next ingestion...');
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
    }

    // Wait until all 3 chats are completed
    console.log(`\n  - Waiting for Round ${r} chats to complete triage sequentially...`);
    const pollStartTime = Date.now();
    const roundChatIds = roundChats.map(c => c.id);
    let completedCount = 0;

    while (completedCount < roundChatIds.length) {
      await new Promise(resolve => setTimeout(resolve, 15000));

      const { data: dbChats, error: pollError } = await supabase
        .from('chats')
        .select('id, status, category_id, priority, summary')
        .in('id', roundChatIds);

      if (pollError) {
        console.error('    ❌ Error polling database:', pollError.message);
        continue;
      }

      const finished = dbChats.filter(c => c.status === 'completed' || c.status === 'failed');
      completedCount = finished.length;
      
      const elapsed = ((Date.now() - pollStartTime) / 1000).toFixed(0);
      console.log(`    [⏱️  Polling - ${elapsed}s elapsed] ${completedCount}/3 finished.`);

      if (completedCount < roundChatIds.length) {
        const pending = dbChats.filter(c => c.status !== 'completed' && c.status !== 'failed').map(c => c.id);
        console.log(`      Still processing: ${pending.join(', ')}`);
      } else {
        console.log(`\n  🎉 All 3 chats in Round ${r} have finished processing!`);
        dbChats.forEach(c => {
          console.log(`    - Chat: ${c.id} (Status: ${c.status})`);
          console.log(`      └─ AI Category: ${c.category_id || 'N/A'}`);
          console.log(`      └─ AI Summary:  "${c.summary || 'N/A'}"`);
        });
      }
    }

    // Space rounds by 2 minutes (120 seconds)
    if (r < 10) {
      console.log('\n💤 Waiting 2 minutes before starting the next round...');
      await new Promise(resolve => setTimeout(resolve, 120000));
    }
  }

  console.log('\n================================================================');
  console.log('🎉 Scheduled Multi-Round Testing Suite (With Non-Issues) Complete!');
  console.log('================================================================\n');
}

run();
