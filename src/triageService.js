import { supabase, getPendingChats, updateTriageResult, getCategories, findSimilarChats, getTrainingExamples, saveChatIssues } from './supabase.js';
import { generateTriage, getEmbedding } from './ollama.js';
import { logTriageAudit } from './triageLogger.js';

/**
 * Orchestrate the triage pipeline:
 * 1. Fetch available categories from Supabase.
 * 2. Fetch pending chats from Supabase.
 * 3. Process each chat through Qwen for triage parameters using dynamic categories.
 * 4. Process the summary through BGE-M3 for vector embedding.
 * 5. Query similar cases in the database via pgvector similarity search.
 * 6. Update the chat entry in Supabase (with category_id foreign key and all intelligence metrics).
 * 
 * @returns {Promise<{processedCount: number, successCount: number, failures: any[]}>}
 */
export async function runTriagePipeline(companyId) {
  console.log(`Starting AI Triage Pipeline for Company: ${companyId || 'Global'}...`);
  
  // 1. Fetch active categories & training examples
  let categories = [];
  let trainingExamples = [];
  try {
    categories = await getCategories(companyId);
    trainingExamples = await getTrainingExamples(companyId);
    console.log(`Loaded ${categories.length} categories and ${trainingExamples.length} training examples from Supabase.`);
  } catch (error) {
    console.error('Error fetching categories or training examples from Supabase:', error);
    throw error;
  }

  // 2. Fetch pending chats
  let pendingChats = [];
  try {
    pendingChats = await getPendingChats(companyId);
    console.log(`Found ${pendingChats.length} pending chats to process.`);
  } catch (error) {
    console.error('Error fetching pending chats from Supabase:', error);
    throw error;
  }

  const results = {
    processedCount: pendingChats.length,
    successCount: 0,
    failures: []
  };

  // 3. Process each chat
  for (const chat of pendingChats) {
    const customerName = chat.customers?.name || 'Unknown customer';
    console.log(`Processing chat ${chat.id} (Customer: ${customerName})...`);
    try {
      if (!chat.conversation) {
        throw new Error(`Chat conversation content is empty`);
      }

      // Step 3a: Run Triage Analysis (qwen2.5:14b) with dynamic categories list & few-shot examples
      console.log(`- Running Triage Analysis (Qwen 2.5)...`);
      const triage = await generateTriage(chat.conversation, categories, trainingExamples);
      console.log(`  Result: CategoryID="${triage.category_id}", Priority="${triage.priority}", Summary="${triage.summary}"`);

      // Step 3b: Generate Embeddings from Summary (bge-m3)
      console.log(`- Generating vector embedding (BGE-M3)...`);
      const embedding = await getEmbedding(triage.summary);
      console.log(`  Result: Vector generated successfully (length: ${embedding.length})`);

      // Step 3c: Search for similar cases in database using pgvector
      console.log(`- Searching for semantically similar cases...`);
      const similarChats = await findSimilarChats(embedding, 0.70, 5);
      
      let finalRecommendation = triage.ai_recommendation;
      if (similarChats.length > 0) {
        // Exclude the current chat itself if it matches (though it is pending so shouldn't have an embedding yet)
        const filteredMatches = similarChats.filter(match => match.id !== chat.id);
        if (filteredMatches.length > 0) {
          const closest = filteredMatches[0];
          console.log(`  Found ${filteredMatches.length} similar cases! Closest similarity: ${(closest.similarity * 100).toFixed(1)}%`);
          finalRecommendation = `[พบคดีที่คล้ายกัน ${(closest.similarity * 100).toFixed(1)}% ID: ${closest.id} - "${closest.summary}"]\n` + triage.ai_recommendation;
        } else {
          console.log(`  No similar cases found after filtering.`);
        }
      } else {
        console.log(`  No similar cases found.`);
      }
      
      finalRecommendation = formatMultiIssuesRecommendation(triage, finalRecommendation);

      // Step 3d: Update results to Supabase using category_id foreign key
      console.log(`- Saving results to Supabase...`);
      const normalizedCategory = normalizeCategoryId(triage.category_id, categories);
      await updateTriageResult(chat.id, {
        category_id: normalizedCategory,
        priority: triage.priority,
        summary: triage.summary,
        embedding,
        sub_category: triage.sub_category,
        intent: triage.intent,
        root_cause: triage.root_cause,
        sentiment: triage.sentiment,
        urgency: triage.urgency,
        department: triage.department,
        keywords: triage.keywords,
        confidence: triage.confidence,
        recommended_reply: triage.recommended_reply,
        resolution: triage.resolution,
        business_impact: triage.business_impact,
        business_impact_score: triage.business_impact_score,
        ai_recommendation: finalRecommendation
      });

      // Step 3e: Save multi-issue breakdown to chat_issues table
      console.log(`- Saving relational multi-issue breakdown to Supabase...`);
      const normalizedIssues = (triage.detected_issues || []).map(iss => ({
        ...iss,
        category_id: normalizeCategoryId(iss.category_id, categories)
      }));
      await saveChatIssues(chat.id, normalizedIssues);

      console.log(`Chat ${chat.id} processed successfully!`);
      results.successCount++;
    } catch (error) {
      console.error(`Failed to process chat ${chat.id}:`, error.message);
      results.failures.push({
        id: chat.id,
        customer_name: customerName,
        error: error.message
      });
    }
  }

  console.log(`AI Triage Pipeline finished. Processed: ${results.processedCount}, Success: ${results.successCount}, Failures: ${results.failures.length}`);
  return results;
}

function classifySentence(text, mainCategory = 'other', fullConversation = '') {
  const lower = (text || '').toLowerCase();
  const fullLower = (fullConversation || '').toLowerCase();

  // 0. Informational Device Statements, Normal Working Statements, Closing Requests & Inquiries -> Category: OTHER
  if (lower.includes('ต้องทำยังไง') || lower.includes('ช่วยดูให้ที') || lower.includes('ช่วยเช็กให้หน่อย') || lower.includes('ช่วยเช็คให้หน่อย') || lower.includes('ช่วยดูให้หน่อย') || lower.includes('ช่วยที') || lower.includes('ช่วยตรวจสอบให้หน่อย') || lower.includes('ช่วยตรวจสอบให้ด้วย') || lower.includes('ช่วยตรวจสอบบัญชี') || lower.includes('รบกวนช่วยตรวจสอบบัญชี') || lower.includes('ช่วยตรวจสอบให้ทีครับ') || lower.includes('เพราะรอมานานมากแล้ว') || lower.includes('ช่วยตรวจสอบให้ที') || lower.includes('ช่วยเช็คให้ที')) {
    if (!lower.includes('ไม่ได้') && !lower.includes('ไม่เข้า') && !lower.includes('ผิด') && !lower.includes('ค้าง') && !lower.includes('ช้า') && !lower.includes('หาย') && !lower.includes('ซ้อนกัน')) {
      return 'other';
    }
  }
  if (lower.includes('ผมใช้มือถือเข้าเว็บ') || lower.includes('เปิดจากคอมพิวเตอร์กลับใช้งานได้') || lower.includes('กลับใช้งานได้') || lower.includes('ใช้งานได้ปกติ')) {
    return 'other';
  }
  if (lower.includes('เป็นเพราะมือถือไม่รองรับ') || lower.includes('หรือเว็บมีปัญหาครับ') || lower.includes('แบบนี้เป็นเพราะ')) {
    return 'other';
  }
  if (lower.includes('ปกติ') || lower.includes('เข้ามาปกติ') || lower.includes('ทำงานปกติ')) {
    if (!lower.includes('ไม่ปกติ') && !lower.includes('ผิดปกติ')) return 'other';
  }
  if (lower.includes('รบกวนช่วยตรวจสอบยอดฝาก') || lower.includes('ช่วยตรวจสอบยอดฝาก') || lower.includes('ช่วยตรวจสอบยอด') || lower.includes('รบกวนช่วยตรวจสอบให้')) {
    return 'other';
  }

  if (lower.includes('ขอบช') || lower.includes('ขอเลขบัญชี') || lower.includes('ขอโบนัส') || lower.includes('ขอรับโบนัส') || lower.includes('ขอโปรโมชั่น') || lower.includes('ขอลิงก์') || lower.includes('สวัสดี') || lower.includes('ขอบคุณ') || lower.includes('หวัดดี') || lower.includes('ฝากตัง') || lower.includes('สอบถามข้อมูล') || lower.includes('ขอสอบถาม')) {
    // Only return other if it doesn't mention an actual error/problem!
    if (!lower.includes('ไม่ได้') && !lower.includes('ไม่เข้า') || lower.includes('ขอบช') || lower.includes('สวัสดี') || lower.includes('ขอบคุณ')) {
      return 'other';
    }
  }

  // 0.1 Compliments, Admin praise, General greetings & Normal Inquiries -> Category: OTHER
  if (lower.includes('บริการดี') || lower.includes('ตอบสุภาพ') || lower.includes('ดูแลดี') || lower.includes('ชื่นชม') || lower.includes('อธิบายชัดเจน') || lower.includes('อธิบายเข้าใจง่าย') || lower.includes('พูดจาสุภาพ') || lower.includes('ตอบแชตไว') || lower.includes('น่ารักเสมอ') || lower.includes('เจริญรุ่งเรือง') || lower.includes('ออเดอร์ปังๆ')) {
    return 'other';
  }

  // 1. Account Security (ความปลอดภัยบัญชี - เปลี่ยนเบอร์โทร/แก้ไขข้อมูลบัญชีไม่ได้)
  if (lower.includes('เปลี่ยนเบอร์') || lower.includes('เปลี่ยนข้อมูล') || lower.includes('แก้ไขข้อมูล') || lower.includes('ข้อมูลบัญชี') || lower.includes('ความปลอดภัย')) return 'account_security';

  // 1.5 API Error & Service Unavailable
  if (lower.includes('service unavailable') || lower.includes('api error') || lower.includes('server error') || lower.includes('timeout') || lower.includes('internal error') || lower.includes('503')) return 'api_error';

  // 2. Access Blocked / Domain / Error Codes (Error 403, 502, 504, 404, 500, 503, 401, 400, เข้าหน้าเว็บไม่ได้/ลิงก์เสีย)
  if (lower.includes('error') || lower.includes('403') || lower.includes('502') || lower.includes('504') || lower.includes('404') || lower.includes('500') || lower.includes('503') || lower.includes('401') || lower.includes('400') || lower.includes('เข้าเว็บไม่ได้') || lower.includes('เข้าหน้าเว็บไม่ได้') || lower.includes('ลิงก์เสีย') || lower.includes('เว็บเข้าไม่ได้') || lower.includes('โดเมน')) return 'access_blocked';

  // 3. Notification / OTP / SMS
  if (lower.includes('otp') || lower.includes('sms') || lower.includes('แจ้งเตือน') || lower.includes('รหัสยืนยัน') || lower.includes('ไม่มีข้อความ') || lower.includes('ส่งใหม่')) return 'notification_issue';

  // 4. Specific UI Rendering (การแสดงผลผิดเพี้ยน / ปุ่มเลื่อนนอกกรอบ / ตัวหนังสือซ้อนกัน / รูปภาพไม่ขึ้น / จอมืด / จอดำ / จอขาว)
  if (lower.includes('มืด') || lower.includes('จอมืด') || lower.includes('จอดำ') || lower.includes('หน้าจอมืด') || lower.includes('หน้าจอดำ') || lower.includes('จอขาว') || lower.includes('หน้าจอขาว') || lower.includes('ตัวหนังสือซ้อนกัน') || lower.includes('นอกกรอบ') || lower.includes('ปุ่มเมนูบางปุ่มหายไป') || lower.includes('ปุ่มหาย') || lower.includes('เมนูหาย') || lower.includes('ซ้อนกัน') || lower.includes('รูปโปรโมชั่น') || lower.includes('รูปก็ไม่ขึ้น') || lower.includes('แสดงไม่เต็มจอ') || lower.includes('รูปไม่ขึ้น') || lower.includes('ชิดขอบ') || lower.includes('รูปภาพหน้าเว็บ')) return 'ui_rendering_issue';

  // 5. Page Load / Freeze / Lag (หน้าเว็บค้าง/โหลดช้า)
  if (lower.includes('กดเข้าเกมแล้วเกมค้าง') || lower.includes('เกมค้าง') || lower.includes('โหลดช้า') || lower.includes('ช้ามาก') || lower.includes('หน้าเว็บช้า') || lower.includes('ค้าง') || lower.includes('หมุน') || lower.includes('โหลดไม่ครบ') || lower.includes('หนืด') || lower.includes('สะดุด') || lower.includes('โหลดไม่ขึ้น') || lower.includes('เด้ง')) return 'page_load_freeze';

  // 5. Account Security & Login (ปัญหาการเข้าสู่ระบบ/บัญชีถูกล็อก/รหัสไม่ถูกต้อง/รีเซ็ตรหัสไม่ได้)
  if (lower.includes('รหัสไม่ถูกต้อง') || lower.includes('รหัสผ่านไม่ถูกต้อง') || lower.includes('รีเซ็ตรหัส') || lower.includes('รีเซ็ต') || lower.includes('รหัสผิด') || lower.includes('รหัส') || lower.includes('เข้าได้อยู่') || lower.includes('พาสเวิร์ด') || lower.includes('บัญชีถูกล็อก') || lower.includes('ถูกล็อก') || lower.includes('ออกจากระบบ') || lower.includes('สมัคร') || lower.includes('เบอร์โทรนี้ถูกใช้งาน') || lower.includes('ถูกใช้งานแล้ว') || lower.includes('ลืมรหัส') || lower.includes('รหัสผ่าน') || lower.includes('แฮก') || lower.includes('ถูกแฮก') || lower.includes('รหัสผ่านผิด') || lower.includes('อายัด') || lower.includes('เข้าไม่ได้') || lower.includes('เข้าสู่ระบบ') || lower.includes('ล็อกอิน') || lower.includes('ล๊อกอิน') || lower.includes('login') || lower.includes('เข้าบัญชี') || lower.includes('ใช้งานบัญชี') || lower.includes('สมัครสมาชิก') || lower.includes('เด้งกลับ') || lower.includes('เด้งกลับหน้าแรก') || lower.includes('เข้าไม่ได้เลย') || lower.includes('บัญชีมีปัญหา') || lower.includes('เป็นที่เว็บหรือบัญชี')) return 'login_issue';

  // 6. Interaction Lag (ปุ่มกด/เมนูกดแล้วไม่ตอบสนอง/กดยืนยันไม่ได้/แอดมินตอบช้า)
  if (lower.includes('กดยืนยันไม่ได้') || lower.includes('ยืนยันไม่ได้') || lower.includes('แอดมินตอบช้า') || lower.includes('แอดมินไม่ตอบ') || lower.includes('ไม่มีแอดมินตอบ') || lower.includes('แอดมินหาย') || lower.includes('ไม่ทำงาน') || lower.includes('คลิ๊ก') || lower.includes('คลิก') || lower.includes('กดปุ่ม') || lower.includes('กดสมัครไม่ได้') || lower.includes('กดไม่ได้') || lower.includes('ไม่ตอบสนอง') || lower.includes('รีเฟรช') || lower.includes('ข้อมูลหาย')) return 'interaction_lag';

  // 7. Feedback Complaint (ลูกค้าบ่น/ร้องเรียน แอดมินตอบช้า ส่งข้อความไม่มีคนตอบ รอนาน เสียเวลา)
  if (lower.includes('ไม่มีใครตอบ') || lower.includes('รอนานมาก') || lower.includes('ส่งข้อความไปหลายครั้ง') || lower.includes('เสียเวลา') || lower.includes('แจ้งกันก่อน') || lower.includes('ร้องเรียน') || lower.includes('แจ้งผลให้ชัดเจน') || lower.includes('ไม่เข้าใจว่าระบบเป็นอะไร')) return 'feedback_complaint';

  // 6. Specific UI Rendering (การแสดงผลผิดเพี้ยน / ปุ่มเมนูหายไป)
  if (lower.includes('ปุ่มเมนูบางปุ่มหายไป') || lower.includes('ปุ่มหาย') || lower.includes('เมนูหาย') || lower.includes('ซ้อนกัน') || lower.includes('รูปโปรโมชั่น') || lower.includes('รูปก็ไม่ขึ้น') || lower.includes('แสดงไม่เต็มจอ') || lower.includes('รูปไม่ขึ้น') || lower.includes('ชิดขอบ')) return 'ui_rendering_issue';

  // 7. Promo & Bonus (check โบนัส/โปรโมชั่น)
  if (lower.includes('โปรโมชั่น') || lower.includes('โบนัส') || lower.includes('โปร') || lower.includes('ของขวัญวันเกิด') || lower.includes('สิทธิ์')) return 'promo_bonus';

  // 8. Deposit & Withdrawal
  if (lower.includes('โอนเงิน') || lower.includes('ฝาก') || lower.includes('ถอน') || lower.includes('ยอดเงิน') || lower.includes('ยอดไม่เข้า') || lower.includes('ยอดยังไม่เข้า') || lower.includes('เงินถูกหัก') || lower.includes('หักเงิน') || lower.includes('เงินไม่เข้า') || lower.includes('ยอดในเว็บ') || lower.includes('รายการถอน') || lower.includes('ถอนเงิน') || lower.includes('เงินยังไม่เข้า')) return 'deposit_withdrawal';

  // 9. Interaction Lag (ปุ่มกด/เมนูกดแล้วไม่ตอบสนอง)
  if (lower.includes('แอดมินตอบช้า') || lower.includes('แอดมินไม่ตอบ') || lower.includes('ไม่มีแอดมินตอบ') || lower.includes('ไม่ทำงาน') || lower.includes('คลิ๊ก') || lower.includes('คลิก') || lower.includes('กดปุ่ม') || lower.includes('กดสมัครไม่ได้') || lower.includes('กดไม่ได้') || lower.includes('ไม่ตอบสนอง') || lower.includes('รีเฟรช') || lower.includes('ข้อมูลหาย')) return 'interaction_lag';

  // 10. General UI Rendering
  if (lower.includes('รูป') || lower.includes('ตัวหนังสือ') || lower.includes('กรอบ') || lower.includes('เพี้ยน') || lower.includes('แสดงผล') || lower.includes('ไม่เต็มจอ')) return 'ui_rendering_issue';

  // 11. Device Compatibility
  if (lower.includes('มือถือ') || lower.includes('อุปกรณ์') || lower.includes('chrome') || lower.includes('safari') || lower.includes('คอมพิวเตอร์') || lower.includes('ไอโฟน') || lower.includes('แอนดรอยด์') || lower.includes('เครื่อง')) return 'device_compatibility';

  // 12. Game Issue
  if (lower.includes('เข้าเกม') || lower.includes('คาสิโน') || lower.includes('เด้งออก') || lower.includes('เล่นเกม') || lower.includes('สล็อต')) return 'game_issue';

  // 13. Contextual Fallback: Inherit mainCategory of conversation if not other
  if (mainCategory && mainCategory !== 'other') {
    return mainCategory;
  }

  return 'other';
}

/**
 * Process a single chat session through the triage pipeline.
 * @param {string} chatId - The ID of the chat.
 */
export async function processSingleChat(chatId) {
  console.log(`Processing single chat ${chatId} in real-time...`);
  try {
    // 1. Fetch the specific chat
    const { data: chat, error: fetchErr } = await supabase
      .from('chats')
      .select('*, customers(*)')
      .eq('id', chatId)
      .single();
      
    if (fetchErr || !chat) {
      throw new Error(`Chat ${chatId} not found in database: ${fetchErr?.message || ''}`);
    }
    
    if (!chat.conversation) {
      throw new Error(`Chat conversation content is empty`);
    }

    // 2. Fetch available categories & training examples for the chat's company
    const categories = await getCategories(chat.company_id);
    const trainingExamples = await getTrainingExamples(chat.company_id);

    // 3. Run Triage Analysis (Qwen 2.5) with training examples
    const triage = await generateTriage(chat.conversation, categories, trainingExamples);
    
    // 4. Generate Embeddings (BGE-M3)
    const embedding = await getEmbedding(triage.summary);
    
    // 5. Search for similar cases (pgvector)
    const similarChats = await findSimilarChats(embedding, 0.70, 5);
    let finalRecommendation = triage.ai_recommendation;
    if (similarChats.length > 0) {
      const filteredMatches = similarChats.filter(match => match.id !== chat.id);
      if (filteredMatches.length > 0) {
        const closest = filteredMatches[0];
        finalRecommendation = `[พบคดีที่คล้ายกัน ${(closest.similarity * 100).toFixed(1)}% ID: ${closest.id} - "${closest.summary}"]\n` + triage.ai_recommendation;
      }
    }
    finalRecommendation = formatMultiIssuesRecommendation(triage, finalRecommendation);

    // 6. Update results in Supabase
    const normalizedCategory = normalizeCategoryId(triage.category_id, categories);
    await updateTriageResult(chat.id, {
      category_id: normalizedCategory,
      priority: triage.priority,
      summary: triage.summary,
      embedding,
      sub_category: triage.sub_category,
      intent: triage.intent,
      root_cause: triage.root_cause,
      sentiment: triage.sentiment,
      urgency: triage.urgency,
      department: triage.department,
      keywords: triage.keywords,
      confidence: triage.confidence,
      recommended_reply: triage.recommended_reply,
      resolution: triage.resolution,
      business_impact: triage.business_impact,
      business_impact_score: triage.business_impact_score,
      ai_recommendation: finalRecommendation
    });

    // 7. Save consolidated multi-issue breakdown to chat_issues table
    console.log(`- Saving relational multi-issue breakdown to Supabase...`);
    
    const convLines = (chat.conversation || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const normalizedFinalIssues = [];

    const topicMap = {};
    convLines.forEach((line) => {
      const cleanLine = line.replace(/^(ลูกค้า|แอดมิน|user|admin)\s*:\s*/i, '').trim();
      if (!cleanLine) return;

      const cat = classifySentence(cleanLine, triage.category_id);
      if (!topicMap[cat]) {
        topicMap[cat] = [];
      }
      topicMap[cat].push(cleanLine);
    });

    if (Object.keys(topicMap).length === 0) {
      const mainCat = triage.category_id || 'deposit_withdrawal';
      topicMap[mainCat] = [triage.summary || chat.conversation.slice(0, 60)];
    }

    Object.entries(topicMap).forEach(([cat, textList]) => {
      const matchedLLMIssue = triage.detected_issues?.find(iss => iss.category_id === cat);
      const matchedSource = matchedLLMIssue ? 'Qwen 2.5 LLM' : 'Keyword Rule Engine';
      const prio = matchedLLMIssue ? (matchedLLMIssue.urgency || 'medium') : (cat === 'account_security' ? 'urgent' : (cat === 'deposit_withdrawal' || cat === 'game_issue' ? 'high' : 'medium'));
      const dept = matchedLLMIssue ? (matchedLLMIssue.department || 'Support') : (cat === 'deposit_withdrawal' ? 'Finance' : (cat === 'ui_rendering_issue' || cat === 'device_compatibility' || cat === 'interaction_lag' || cat === 'page_load_freeze' ? 'Developer' : 'Support'));
      const reply = matchedLLMIssue ? (matchedLLMIssue.recommended_reply || triage.recommended_reply) : triage.recommended_reply;

      let summaryText = textList[0];
      if (textList.length > 1) {
        summaryText = textList.slice(0, 3).join(' / ');
      }

      normalizedFinalIssues.push({
        chat_id: chat.id,
        category_id: normalizeCategoryId(cat, categories),
        priority: prio,
        department: dept,
        summary: summaryText,
        recommended_reply: reply,
        source: matchedSource
      });
    });

    await saveChatIssues(chat.id, normalizedFinalIssues);

    // Output detailed audit log for full transparency
    logTriageAudit(chatId, {
      conversation: chat.conversation,
      llmResponse: triage,
      llmDetectedIssues: triage.detected_issues || [],
      sentenceBreakdown: normalizedFinalIssues,
      primaryDecision: {
        category_id: triage.category_id,
        priority: triage.priority,
        urgency: triage.urgency,
        department: triage.department,
        sentiment: triage.sentiment,
        root_cause: triage.root_cause,
        summary: triage.summary
      }
    });

    console.log(`Single chat ${chatId} processed successfully!`);
  } catch (err) {
    console.error(`Error in processSingleChat for ${chatId}:`, err);
    // Mark as failed in Supabase so queue doesn't hang
    await supabase.from('chats').update({ status: 'failed', summary: `Triage failed: ${err.message}` }).eq('id', chatId);
    throw err;
  }
}

/**
 * Helper to format multi-issue breakdowns from AI triage into a readable list.
 * @param {object} triage - The raw AI output object.
 * @param {string} baseRec - The existing AI recommendation / case similarity string.
 * @returns {string} - The formatted recommendation.
 */
function formatMultiIssuesRecommendation(triage, baseRec) {
  let recommendation = baseRec || '';
  
  if (triage.detected_issues && triage.detected_issues.length > 0) {
    let breakdown = `\n\n📌 [ประเด็นปัญหาทั้งหมดที่ตรวจพบในแชตนี้ (Multi-Issue Breakdown)]:\n`;
    triage.detected_issues.forEach(issue => {
      breakdown += `- **เรื่องที่ ${issue.issue_no || 1}:** ${issue.problem_summary || ''}\n`;
      breakdown += `  - หมวดหมู่: ${issue.category_id || 'อื่นๆ'}\n`;
      breakdown += `  - แผนก: ${issue.department || 'Support'} (ความเร่งด่วน: ${issue.urgency || 'low'})\n`;
      if (issue.recommended_reply) {
        breakdown += `  - แนะนำบทสนทนาตอบลูกค้า: "${issue.recommended_reply}"\n`;
      }
    });
    recommendation += breakdown;
  }
  
  return recommendation;
}

/**
 * Normalize category ID from LLM output by matching it against company's categories.
 * @param {string} id - Raw category ID from LLM.
 * @param {any[]} categories - List of active categories for the company.
 * @returns {string} - The correct resolved category ID.
 */
function normalizeCategoryId(id, categories) {
  if (!id || !categories || categories.length === 0) return null;
  // 1. Direct match
  if (categories.some(c => c.id === id)) return id;
  // 2. Suffix match (e.g. "deposit_withdrawal" matching "company_id:deposit_withdrawal")
  const suffix = id.split(':').pop();
  const suffixMatch = categories.find(c => c.id.endsWith(`:${suffix}`) || c.id.endsWith(`:${id}`) || c.id === suffix);
  if (suffixMatch) return suffixMatch.id;
  // 3. Name match (case-insensitive)
  const nameMatch = categories.find(c => c.name.toLowerCase() === id.toLowerCase());
  if (nameMatch) return nameMatch.id;
  // 4. Default to first category
  return categories[0].id;
}
