import { supabase, getPendingChats, updateTriageResult, getCategories, findSimilarChats, getTrainingExamples, saveChatIssues } from './supabase.js';
import { generateTriage, getEmbedding } from './ollama.js';
import { logTriageAudit } from './triageLogger.js';
import { checkCompanyQuota } from './quotaService.js';
import { waitForInteractiveIdle } from './aiScheduler.js';

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
  
  // 0. Quota Check: If company specified, check if monthly quota is exceeded
  if (companyId) {
    const quota = await checkCompanyQuota(companyId);
    if (quota.isExceeded) {
      const errMsg = `โควต้าแชตประจำเดือนเต็ม: บริษัท ${quota.companyName} ใช้โควต้าครบกำหนดของแพ็กเกจ ${quota.packageName} (${quota.monthlyLimit?.toLocaleString()} แชต) แล้วในรอบนี้`;
      console.warn(`⛔ [Pipeline Blocked] ${errMsg}`);
      throw new Error(errMsg);
    }
  }

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

      // Step 3a: Layer 1 Dynamic Clause Segmentation + Layer 2 Triage Analysis (qwen2.5:14b)
      const { clauses: preSegmentedClauses } = segmentConversationIntoClauses(chat.conversation);
      console.log(`- Running Triage Analysis (Qwen 2.5) across ${preSegmentedClauses.length} dynamic clauses...`);
      await waitForInteractiveIdle(`runTriagePipeline (${chat.id}) - Qwen Triage`);
      const triage = await generateTriage(chat.conversation, categories, trainingExamples, preSegmentedClauses);
      console.log(`  Result: CategoryID="${triage.category_id}", Priority="${triage.priority}", Summary="${triage.summary}"`);

      // Step 3b: Generate Embeddings from Summary (bge-m3)
      console.log(`- Generating vector embedding (BGE-M3)...`);
      await waitForInteractiveIdle(`runTriagePipeline (${chat.id}) - BGE-M3 Embedding`);
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

      // Step 3d: Prepare & validate multi-issue breakdown using Layer 3 Dynamic Semantic Engine
      const sanitizedDetectedIssues = (triage.detected_issues || []).map(iss => {
        const text = iss.problem_summary || iss.summary || '';
        const validated = sanitizeAndValidateIssueCategory(text, iss.category_id, categories);
        return {
          ...iss,
          category_id: validated.category_id,
          urgency: validated.isGuarded && validated.priority ? validated.priority : (iss.urgency || iss.priority || 'medium'),
          department: validated.isGuarded && validated.department ? validated.department : (iss.department || 'Support')
        };
      });

      let normalizedIssues = sanitizedDetectedIssues.map(iss => ({
        chat_id: chat.id,
        category_id: iss.category_id,
        priority: iss.urgency || iss.priority || triage.priority || 'medium',
        department: iss.department || triage.department || 'Support',
        summary: iss.problem_summary || iss.summary || triage.summary || 'ไม่มีบทสรุป',
        recommended_reply: ''
      }));
      normalizedIssues = await ensureCompleteSentenceCoverage(
        chat.conversation,
        normalizedIssues,
        categories,
        chat.id,
        triage.priority || 'medium',
        triage.department || 'Support'
      );

      // Step 3e: Update primary chat result & save multi-issue breakdown to Supabase
      console.log(`- Saving results & relational multi-issue breakdown to Supabase...`);
      const normalizedCategory = resolvePrimaryCategory(triage.category_id, normalizedIssues, categories);
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

/**
 * Calculate Cosine Similarity between two numeric vectors.
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Deterministic Semantic Guard & Normalizer
 * Enforces critical business rules and prevents misclassification for known edge cases.
 * @param {string} text - Sentence or summary text.
 * @param {string} rawCategoryId - Raw category ID from LLM.
 * @param {any[]} categories - Available categories for the company.
 * @returns {{ category_id: string, priority?: string, department?: string, isGuarded: boolean }}
 */
export function sanitizeAndValidateIssueCategory(text, rawCategoryId, categories = []) {
  if (!text) {
    return {
      category_id: normalizeCategoryId(rawCategoryId, categories),
      isGuarded: false
    };
  }

  const cleanText = text.trim();
  const lower = cleanText.toLowerCase();

  // Guard 1: OTP / SMS / Missing Confirmation Email failure rule
  const isOtpOrEmailIssue = /(otp|โอทีพี|sms).*(ไม่มา|ไม่เข้า|ไม่ส่ง|ไม่ได้|ไม่ได้รับ|ช้า)|(ไม่ได้รับ|ไม่ส่ง|ไม่ได้).*(otp|โอทีพี|sms)/i.test(cleanText) ||
    /(ไม่ได้รับ|ยังไม่ได้รับ|ไม่มี).*(อีเมลยืนยัน|อีเมล์ยืนยัน|email ยืนยัน|การแจ้งเตือน|sms|otp)/i.test(cleanText) ||
    /(อีเมล|อีเมล์|email).*(ไม่เข้า|ไม่ส่ง|ไม่มา|ไม่ได้รับ)/i.test(cleanText);
  if (isOtpOrEmailIssue) {
    const notifCat = categories.find(c => c.id.endsWith(':notification_issue') || c.id === 'notification_issue');
    if (notifCat) {
      return { category_id: notifCat.id, priority: 'medium', department: 'Support', isGuarded: true };
    }
  }

  // Guard 2: Login failure / blocked account / unverified status on login attempt
  const isLoginIssue = /(พอลองเข้าสู่ระบบ|ลองเข้าสู่ระบบ|เข้าสู่ระบบ|ล็อกอิน|login).*(ยังไม่สามารถใช้งาน|ใช้งานไม่ได้|เข้าไม่ได้|ไม่ได้ยืนยัน|เซสชันหมดอายุ|รหัสผ่านผิด|โดนระงับ|ถูกระงับ|ถูกบล็อก|วนกลับไปหน้า)/i.test(cleanText);
  if (isLoginIssue) {
    const loginCat = categories.find(c => c.id.endsWith(':login_issue') || c.id === 'login_issue');
    if (loginCat) {
      return { category_id: loginCat.id, priority: 'high', department: 'Support', isGuarded: true };
    }
  }

  // Guard 2b: Feature request & function additions
  const isFeatureRequest = /(เพิ่มฟังก์ชัน|ขอเพิ่มฟังก์ชัน|อยากให้มีฟังก์ชัน|อยากให้มีระบบ|เพิ่มระบบ|ขอเพิ่มระบบ|ฟังก์ชันเปรียบเทียบ|ระบบเปรียบเทียบ|ขอให้มีปุ่ม|อยากให้ทำฟีเจอร์|ขอฟีเจอร์|เพิ่มตัวเลือก)/i.test(cleanText);
  if (isFeatureRequest) {
    const featCat = categories.find(c => c.id.endsWith(':feature_request') || c.id === 'feature_request');
    if (featCat) {
      return { category_id: featCat.id, priority: 'medium', department: 'Developer', isGuarded: true };
    }
  }

  // Guard 3: Customer feedback, complaints, and service improvement suggestions
  const isFeedbackOrComplaint = /(ปัญหาแบบนี้ทำให้|ทำให้การเริ่มใช้งาน|ยุ่งยากมาก|เกือบจะเปลี่ยน|บริการแย่|ไม่โอเคมาก|เสียเวลา|ลองซ้ำ|จนไม่สามารถตัดสินใจซื้อได้|รู้สึกผิดหวัง|ผิดหวัง|ท้อ|ไม่ประทับใจ|ปัญหาแบบนี้ไม่ควรเกิดขึ้น|อยากให้ปรับปรุง|ช่วยปรับปรุงระบบ|ช่วยตรวจสอบ|ปรับปรุงข้อความแจ้งข้อผิดพลาด)/i.test(cleanText);
  if (isFeedbackOrComplaint) {
    const feedbackCat = categories.find(c => c.id.endsWith(':feedback_complaint') || c.id === 'feedback_complaint');
    if (feedbackCat) {
      return { category_id: feedbackCat.id, priority: 'medium', department: 'Support', isGuarded: true };
    }
  }

  // Guard 4: Registration errors / email already registered
  const isRegistrationIssue = /(สมัครสมาชิก|กดสมัคร|ปุ่มสมัคร).*(เกิดข้อผิดพลาด|ผิดพลาด|ไม่ได้|ล้มเหลว)|(อีเมลนี้|อีเมล์นี้|เบอร์นี้).*(ถูกใช้งานแล้ว|ถูกใช้แล้ว|ซ้ำ)/i.test(cleanText);
  if (isRegistrationIssue) {
    const regCat = categories.find(c => c.id.endsWith(':registration') || c.id === 'registration');
    if (regCat) {
      return { category_id: regCat.id, priority: 'high', department: 'Support', isGuarded: true };
    }
  }

  // Guard 5: Account security / change sensitive info (bank account, phone number, password, credentials)
  const isBankOrSecurityChange = /(เปลี่ยน|แก้|ย้าย|อัปเดต|ขอเปลี่ยน|ขอแก้).*(บัญชีธนาคาร|เลขบัญชี|สมุดบัญชี|เบอร์โทร|เบอร์ศัพท์)|(ขอเปลี่ยน|ขอแก้).*(บัญชี|เบอร์)/i.test(cleanText);
  if (isBankOrSecurityChange) {
    const secCat = categories.find(c => c.id.endsWith(':account_security') || c.id === 'account_security');
    if (secCat) {
      return { category_id: secCat.id, priority: 'high', department: 'Support', isGuarded: true };
    }
  }

  // Guard 6: Access blocked / broken links / 403 / 404 / 500 / outage
  const isAccessBlocked = /(ขอลิงก์|ขอลิ้ง|ขอเว็บ).*(ใหม่|สำรอง|เดิม|ไม่ได้|เข้าไม่ได้)|(ลิงก์|ลิ้ง|link).*(เป็นอะไร|เข้าไม่ได้|เสีย|พัง|เปิดไม่ติด|โหลดไม่ขึ้น|error)|(เข้าเว็บ|เข้าเว็บไซต์|เข้าหน้าเว็บ|เข้า web|เปิดเว็บ|เปิดเว็บไซต์).*(ไม่ได้|ไม่สำเร็จ|ไม่ติด| error| 403| 404)|(403|404|500|502|forbidden|access denied|blocked)/i.test(cleanText);
  if (isAccessBlocked) {
    const accessCat = categories.find(c => c.id.endsWith(':access_blocked') || c.id === 'access_blocked');
    if (accessCat) {
      return { category_id: accessCat.id, priority: 'high', department: 'Support', isGuarded: true };
    }
  }

  // Guard 7: Page load freeze / loading delay / refresh
  const isPageFreeze = /(รีเฟรช|refresh).*(ถึงจะเห็น|ถึงจะขึ้น|ถึงจะอัปเดต)|(หน้าเว็บ|เว็บ|หน้าเว็บไซต์).*(โหลดช้า|ค้าง|หมุน|ช้ามาก|เปิดช้า|โหลดรายละเอียด)|(โหลดช้ามาก|โหลดนานมาก|ค้างบ่อย|หมุนติ้ว)/i.test(cleanText);
  if (isPageFreeze) {
    const freezeCat = categories.find(c => c.id.endsWith(':page_load_freeze') || c.id === 'page_load_freeze' || c.id.endsWith(':performance_issue') || c.id === 'performance_issue');
    if (freezeCat) {
      return { category_id: freezeCat.id, priority: 'medium', department: 'Support', isGuarded: true };
    }
  }

  // Guard 8: Button response lag / multiple clicks / freeze
  const isButtonLag = /(กดหลายครั้ง|กดซ้ำ|กดแล้วไม่ไป|ปุ่มไม่ตอบสนอง|ตอบสนองช้า|ไม่ตอบสนอง|ไม่มีการตอบสนอง|กว่าจะเลือกได้|กว่าจะติด|ระบบถึงเลือกให้|ปุ่ม.*ค้าง|ระบบยังตอบสนองช้า)/i.test(cleanText);
  if (isButtonLag) {
    const lagCat = categories.find(c => c.id.endsWith(':interaction_lag') || c.id === 'interaction_lag');
    if (lagCat) {
      return { category_id: lagCat.id, priority: 'medium', department: 'Support', isGuarded: true };
    }
  }

  // Guard 9: Graphics / UI Rendering Issue
  const isUiRendering = /(แสดงผลผิดปกติ|แสดงผลเพี้ยน|ตัดทอน|ถูกตัด|ไม่จบประโยค|ตกขอบ|ล้นขอบ|เลยขอบ|ล้นจอ|เลยขอบหน้าจอ|ตัวหนังสือซ้อน|ฟอนต์เละ|ปุ่มอยู่เลย|ปุ่มล้น|หลุดกรอบ|รูป.*(ไม่ขึ้น|หาย|ว่าง|ถูกตัด|แตก|เป็นพื้นที่ว่าง|กลายเป็นพื้นที่ว่าง)|การแสดงผล.*(ผิดปกติ|เพี้ยน|ไม่สมบูรณ์|ไม่ตรง)|หน้าเว็บ.*แสดงผลผิดปกติ)/i.test(cleanText);
  if (isUiRendering) {
    const uiCat = categories.find(c => c.id.endsWith(':ui_rendering_issue') || c.id === 'ui_rendering_issue');
    if (uiCat) {
      return { category_id: uiCat.id, priority: 'low', department: 'Support', isGuarded: true };
    }
  }

  // Guard 10: Device / Browser compatibility
  const isDeviceComp = /(เบราว์เซอร์อื่น|บราวเซอร์อื่น|browser อื่น|ลองเปิดผ่าน|เปิดผ่านเบราว์เซอร์|เปิดผ่านบราวเซอร์|ลองเปลี่ยนเบราว์เซอร์|chrome|safari|firefox|edge|อุปกรณ์อื่น|ลองเครื่องอื่น|มือถือกับคอม|เปิดในคอม|เปิดในมือถือ|บนคอมพิวเตอร์|สลับไปใช้คอม|สลับไปใช้มือถือ|ไม่รองรับมือถือ|หน้าจอมือถือ|เฉพาะในมือถือ|สั่งซื้อผ่านมือถือ)/i.test(cleanText);
  if (isDeviceComp) {
    const devCat = categories.find(c => c.id.endsWith(':device_compatibility') || c.id === 'device_compatibility');
    if (devCat) {
      return { category_id: devCat.id, priority: 'medium', department: 'Support', isGuarded: true };
    }
  }

  // Guard 11: Deposit / Withdrawal issue
  const isDepositWithdrawal = /(ถอน|ฝาก|โอน).*(ไม่เข้า|ช้า|ดีเลย์|ยังไม่ได้|หาย|ไม่อัปเดต|ค้าง)/i.test(cleanText);
  if (isDepositWithdrawal) {
    const depCat = categories.find(c => c.id.endsWith(':deposit_withdrawal') || c.id === 'deposit_withdrawal');
    if (depCat) {
      return { category_id: depCat.id, priority: 'high', department: 'Support', isGuarded: true };
    }
  }

  // Guard 12: General context or inquiries without problems -> other
  const isGenericGreeting = /^(สวัสดี(ครับ|ค่ะ)?|ขอบคุณ(ครับ|ค่ะ)?|หวัดดี(ครับ|ค่ะ)?|ขอสอบถามหน่อย(ครับ|ค่ะ)?)$/i.test(lower);
  const isShoppingContext = /^(ผม|ดิฉัน|หนู)?\s*(กำลัง|จะ|กำลังจะ|ลอง)\s*(ซื้อ|เลือก|ดู|หา|สั่งซื้อ|สั่ง)/i.test(cleanText);
  if (isGenericGreeting || isShoppingContext) {
    const otherCat = categories.find(c => c.id.endsWith(':other') || c.id === 'other');
    if (otherCat) {
      return { category_id: otherCat.id, priority: 'low', department: 'Support', isGuarded: true };
    }
  }

  return {
    category_id: normalizeCategoryId(rawCategoryId, categories),
    isGuarded: false
  };
}

/**
 * Layer 1: Dynamic Thai Discourse & Clause Segmenter
 * Splits raw customer conversation (multi-line or single-paragraph) into atomic semantic clauses
 * based on speaker turns, Thai sentence-boundary spaces, and contrasting/additive discourse markers.
 * @param {string} conversation - Raw conversation string.
 * @returns {{ clauses: string[], isSingleParagraph: boolean }}
 */
export function segmentConversationIntoClauses(conversation) {
  if (!conversation) return { clauses: [], isSingleParagraph: false };

  // 1. Split by newlines and inline speaker labels (e.g. "ลูกค้า: ... ลูกค้า: ...")
  const rawTurns = conversation
    .split(/\n|(?:^|\s+)(?:ลูกค้า|ผู้ใช้|แอดมิน|เจ้าหน้าที่|User|Customer|Admin):\s*/i)
    .map(s => s.replace(/^(?:ลูกค้า|ผู้ใช้|แอดมิน|เจ้าหน้าที่|User|Customer|Admin):\s*/i, '').trim())
    .filter(Boolean);

  const isSingleParagraph = rawTurns.length === 1;
  const sentences = [];

  for (const turn of rawTurns) {
    if (isSingleParagraph) {
      // Split single-paragraph text by Thai sentence-boundary spaces while preserving English/numeric phrases
      const parts = turn
        .split(/(?<=[\u0E00-\u0E7F%])\s+(?=[\u0E00-\u0E7F])/g)
        .map(p => p.trim())
        .filter(Boolean);

      let pendingPrefix = '';
      for (let i = 0; i < parts.length; i++) {
        const orig = parts[i];
        const curr = pendingPrefix ? `${pendingPrefix} ${orig}` : orig;
        pendingPrefix = '';

        // Dependent temporal/conditional lead-in clauses attach to the following main clause
        const isLeadIn = (/^(นอกจากนี้|ยิ่งไปกว่านั้น|แถม)?\s*(เมื่อ|เวลา|ตอนที่|ระหว่างที่|ขณะที่)/.test(orig) ||
          /^(ก่อนจะ|ตอนจะ|เวลาจะ)/.test(orig) ||
          /^(บางครั้งหน้าเปิดได้|พอกดรีเฟรชหลายครั้ง|พอกดเพิ่มสินค้า|อกดเพิ่มสินค้า|(ฉัน|ผม|หนู|ดิฉัน)?\s*(พยายาม|ลอง|กำลัง|จะ|ได้ทำการ|ได้ลอง))/.test(orig)) &&
          !/(กลับ|พบว่า|ปรากฏว่า|ได้ตามปกติ|เลยค่ะ|เลยครับ|ค่ะ|ครับ|คะ)$/.test(orig);
        if (isLeadIn && i + 1 < parts.length) {
          pendingPrefix = curr;
          continue;
        }

        const prevSent = sentences.length > 0 ? sentences[sentences.length - 1] : '';
        const prevHasRequest = /(อยากให้|รบกวน|ช่วย|ขอให้|เสนอแนะให้|ปรับปรุง|แก้ไข|ตรวจสอบ)/.test(prevSent);

        const isFeatureRequestStart = /^(และ\s*)?(เพิ่มฟังก์ชัน|ขอเพิ่มฟังก์ชัน|อยากให้มีฟังก์ชัน|เพิ่มระบบ|ขอเพิ่มระบบ|อยากให้มีระบบ|ขอฟีเจอร์|อยากให้เพิ่ม|ขอเพิ่ม)/.test(orig);
        const isNounPhraseWithoutFailure = /^การ(?!.+?(ไม่ได้|ไม่สำเร็จ|ล้มเหลว|พัง|ค้าง|ช้า|เออเร่อ|หลุด|หาย))/.test(orig);
        const isConjunctionOrContinuation = !isFeatureRequestStart && /^(และการ|และ(?!ไม่มี|ไม่ได้รับ)|หรือ|รวมถึง|ตลอดจน|พร้อม(ทั้ง|ปรับปรุง)?|เพื่อ)/.test(orig);
        const isElaborationOrFeeling = /^(ฉันไม่รู้ว่า|ไม่แน่ใจว่า|และไม่อยาก|ไม่อยากเสี่ยง|กลัวว่า|กลัวเกิด)/.test(orig);
        const isClosingFeedbackChain = /^(อยากให้|รบกวน|ช่วยปรับปรุง|ช่วยแก้ไข)/.test(orig) && /(ปัญหาแบบนี้|ยุ่งยากมาก|เกือบจะเปลี่ยน|บริการแย่|เสียเวลามาก)/.test(prevSent);
        const isButClause = /^(แต่|ทว่า)/.test(orig);

        // Dependent tail elaboration, continuation & enumerated items attach to preceding clause
        const isTailElaboration = /^(ขึ้น\s+\d+|อ่านไม่รู้เรื่อง|กว่าจะ|เห็นแต่|ต้องกดซ้ำ|ต้องกดหลาย|สมัครก็ไม่ได้|ติดต่อใช้งานก็ลำบาก|ช่วยแก้ไขด่วน)/.test(orig) ||
          isNounPhraseWithoutFailure ||
          isButClause ||
          (prevHasRequest && (isConjunctionOrContinuation || /^(ขั้นตอน|ระบบ)/.test(orig))) ||
          isConjunctionOrContinuation ||
          isElaborationOrFeeling ||
          isClosingFeedbackChain;

        if (isTailElaboration && sentences.length > 0) {
          sentences[sentences.length - 1] += ` ${curr}`;
          continue;
        }

        sentences.push(curr);
      }
      if (pendingPrefix) {
        if (sentences.length > 0) {
          sentences[sentences.length - 1] += ` ${pendingPrefix}`;
        } else {
          sentences.push(pendingPrefix);
        }
      }
    } else {
      sentences.push(turn);
    }
  }

  // 2. Split compound clauses connected by Thai discourse markers (ทั้งที่, และ, แต่) when joining two distinct failure/action predicates
  const finalClauses = [];
  for (const sent of sentences) {
    const subParts = sent
      .split(/(?<=.{10,}?)\s*(?=(?:ทั้งที่.{8,}|และ(?:ไม่มี(?!การตอบสนอง)|ไม่ได้รับ|เปิดประวัติ|หน้าเว็บ)|แต่(?:เงินถูกหัก|ฉันยังไม่ได้รับ|ยังไม่ได้รับ)))/g)
      .map(s => s.trim())
      .filter(Boolean);
    finalClauses.push(...subParts);
  }

  return { clauses: finalClauses, isSingleParagraph };
}

/**
 * Layer 3: Dynamically classify a clause/sentence using BGE-M3 Vector Semantic Matching
 * combined with dynamic phrase matching against category descriptions stored in Supabase.
 * @param {string} text - The clause/sentence to classify.
 * @param {any[]} categories - Available dynamic categories for the company (with embeddings & descriptions).
 * @param {string} mainCategory - Fallback category ID.
 * @returns {Promise<{ category_id: string, similarity: number, vectorSimilarity: number, source: string }>}
 */
export async function classifySentenceSemantic(text, categories = [], mainCategory = 'other') {
  if (!text || !categories || categories.length === 0) {
    return { category_id: mainCategory || 'other', similarity: 0, vectorSimilarity: 0, source: 'Fallback' };
  }

  const cleanText = text.trim();

  // Deterministic rule check
  const ruleCheck = sanitizeAndValidateIssueCategory(cleanText, null, categories);
  if (ruleCheck && ruleCheck.isGuarded) {
    return {
      category_id: ruleCheck.category_id,
      similarity: 1.0,
      vectorSimilarity: 1.0,
      source: 'Deterministic Rule Guard'
    };
  }

  try {
    // Generate embedding for the clause using local BGE-M3 model
    const sentenceVector = await getEmbedding(cleanText);
    if (!sentenceVector || sentenceVector.length === 0) {
      return { category_id: mainCategory || 'other', similarity: 0, vectorSimilarity: 0, source: 'Fallback' };
    }

    // Rank categories dynamically by BGE-M3 cosine similarity + dynamic DB description phrase similarity
    const scoredCategories = categories
      .filter(c => c.embedding)
      .map(c => {
        const catEmbedding = typeof c.embedding === 'string' ? JSON.parse(c.embedding) : c.embedding;
        const vSim = cosineSimilarity(sentenceVector, catEmbedding);

        // Dynamic schema phrase matching against c.description and c.name from Supabase
        const phrases = `${c.name || ''}, ${c.description || ''}`
          .split(/[,/]+/)
          .map(p => p.trim())
          .filter(p => p.length >= 3);
        let maxPhraseSim = 0;
        for (const phrase of phrases) {
          const ps = calculateTextSimilarity(cleanText, phrase);
          if (ps > maxPhraseSim) maxPhraseSim = ps;
        }

        const hybridScore = vSim + (maxPhraseSim * 0.15);
        return {
          category_id: c.id,
          name: c.name,
          similarity: hybridScore,
          vectorSimilarity: vSim
        };
      })
      .sort((a, b) => b.similarity - a.similarity);

    if (scoredCategories.length > 0 && scoredCategories[0].similarity >= 0.55) {
      return {
        category_id: scoredCategories[0].category_id,
        similarity: scoredCategories[0].similarity,
        vectorSimilarity: scoredCategories[0].vectorSimilarity,
        source: 'Dynamic Vector + DB Schema Engine (BGE-M3)'
      };
    }
  } catch (err) {
    console.warn(`Vector semantic matching error for "${cleanText}":`, err.message);
  }

  // Safe dynamic fallback to company's 'other' category for non-matching or general sentences
  const otherCat = categories.find(c => c.id.endsWith(':other') || c.id === 'other');
  return { category_id: otherCat ? otherCat.id : 'other', similarity: 0, vectorSimilarity: 0, source: 'Dynamic Non-Problem Fallback' };
}

/**
 * Calculate Bigram Dice Coefficient similarity between two strings.
 */
function calculateTextSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2 || s1.includes(s2) || s2.includes(s1)) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0;
  const getBigrams = (str) => {
    const bigrams = new Set();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.substring(i, i + 2));
    }
    return bigrams;
  };
  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  let intersection = 0;
  for (const bg of b1) {
    if (b2.has(bg)) intersection++;
  }
  return (2.0 * intersection) / (b1.size + b2.size);
}

/**
 * Layer 3: Dynamic Clause Coverage, Compound Splitting & Same-Category Consolidation
 * Ensures every atomic clause from Layer 1 is classified against the company's dynamic categories in Supabase,
 * splits any compound LLM issue that bundled multiple clauses of different categories,
 * and never overwrites a single issue summary with the entire multi-sentence paragraph.
 */
export async function ensureCompleteSentenceCoverage(
  conversation,
  detectedIssues,
  categories,
  chatId,
  defaultPriority = 'medium',
  defaultDepartment = 'Support'
) {
  if (!conversation) return detectedIssues || [];

  const { clauses, isSingleParagraph } = segmentConversationIntoClauses(conversation);
  if (clauses.length === 0) return detectedIssues || [];

  const llmIssues = [...(detectedIssues || [])];
  const otherCatObj = categories.find(c => c.id.endsWith(':other') || c.id === 'other');
  const otherCatId = otherCatObj ? otherCatObj.id : 'other';

  const resolvedClauseIssues = [];

  for (const clause of clauses) {
    const clauseLower = clause.toLowerCase();

    // Find if an LLM issue matches specifically this single clause (and did NOT bundle multiple distinct clauses together)
    const matchingLlmIssue = llmIssues.find(iss => {
      const s = (iss.summary || '').toLowerCase().trim();
      if (!s) return false;
      const spannedClausesCount = clauses.filter(cl => s.includes(cl.toLowerCase())).length;
      if (spannedClausesCount > 1) {
        // LLM bundled multiple clauses into one issue; do not treat as a single-clause match so we can verify/split each clause
        return false;
      }
      if (s === clauseLower || s.includes(clauseLower) || clauseLower.includes(s)) return true;
      return calculateTextSimilarity(clauseLower, s) >= 0.65;
    });

    const semanticMatch = await classifySentenceSemantic(clause, categories, otherCatId);

    let finalCategoryId = semanticMatch.category_id || otherCatId;
    let finalPriority = defaultPriority;
    let finalDepartment = defaultDepartment || 'Support';
    let matchSource = semanticMatch.source;

    if (matchingLlmIssue) {
      const llmCatNormalized = normalizeCategoryId(matchingLlmIssue.category_id, categories) || otherCatId;
      // Trust LLM category for single-clause match unless Dynamic Vector+Schema Engine is highly confident (>= 0.78) on a different category
      if (semanticMatch.similarity >= 0.78 && semanticMatch.category_id !== llmCatNormalized) {
        finalCategoryId = semanticMatch.category_id;
        matchSource = `${semanticMatch.source} (Override)`;
      } else {
        finalCategoryId = llmCatNormalized;
        matchSource = 'LLM Atomic Clause + Verified';
      }
      finalPriority = matchingLlmIssue.priority || matchingLlmIssue.urgency || defaultPriority;
      finalDepartment = matchingLlmIssue.department || defaultDepartment || 'Support';
    } else {
      const isOther = finalCategoryId === otherCatId || finalCategoryId.endsWith(':other');
      finalPriority = isOther ? 'low' : defaultPriority;
      finalDepartment = 'Support';
    }

    // Re-verify deterministic guard on the atomic clause
    const guarded = sanitizeAndValidateIssueCategory(clause, finalCategoryId, categories);
    if (guarded.isGuarded) {
      finalCategoryId = guarded.category_id;
      if (guarded.priority) finalPriority = guarded.priority;
      if (guarded.department) finalDepartment = guarded.department;
      matchSource = 'Deterministic Rule Guard';
    }

    resolvedClauseIssues.push({
      chat_id: chatId,
      category_id: finalCategoryId,
      priority: finalPriority,
      department: finalDepartment,
      summary: clause,
      recommended_reply: '',
      source: matchSource
    });
  }

  // Consolidate issues by category_id across the chat session
  // So that each distinct problem category has ONE unified, comprehensive issue
  // and no orphan incomplete noun phrases are stored
  const consolidatedByCategory = [];
  const priorityRank = { urgent: 4, high: 3, medium: 2, low: 1 };

  for (const item of resolvedClauseIssues) {
    // Skip standalone incomplete noun fragments without predicates (e.g. "การส่งอีเมลยืนยัน", "และการเข้าสู่ระบบ")
    const isOrphanNounPhrase = /^(\s*(และการ|การ|และ|หรือ|พร้อม)\s*[\u0E00-\u0E7F]{2,20}\s*)$/.test(item.summary) &&
      !/(ไม่ได้|ไม่สำเร็จ|ล้มเหลว|พัง|ค้าง|ช้า|เออเร่อ|หลุด|หาย|เกิดข้อผิดพลาด|แจ้งว่า|ถูกใช้งาน)/.test(item.summary);
    if (isOrphanNounPhrase) continue;

    // RULE: NEVER consolidate 'other' category across clauses into a monster issue!
    const isOtherCat = (item.category_id || '').split(':').pop().trim().toLowerCase() === 'other';
    if (isOtherCat) {
      consolidatedByCategory.push({ ...item });
      continue;
    }

    const existing = consolidatedByCategory.find(c => c.category_id === item.category_id);
    if (existing) {
      if (!existing.summary.includes(item.summary)) {
        existing.summary = `${existing.summary} ${item.summary}`.trim();
      }
      const existingRank = priorityRank[existing.priority] || 2;
      const newRank = priorityRank[item.priority] || 2;
      if (newRank > existingRank) {
        existing.priority = item.priority;
      }
    } else {
      consolidatedByCategory.push({ ...item });
    }
  }

  return consolidatedByCategory.length > 0 ? consolidatedByCategory : resolvedClauseIssues;
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

    // 1.1 Quota Enforcement: Check if company has exceeded monthly chat quota
    if (chat.company_id) {
      const quota = await checkCompanyQuota(chat.company_id);
      if (quota.isExceeded) {
        console.warn(`⛔ [Triage Blocked] Chat ${chatId} skipped: Company "${quota.companyName}" has reached monthly limit (${quota.currentUsage}/${quota.monthlyLimit}).`);
        await supabase
          .from('chats')
          .update({
            status: 'quota_exceeded',
            summary: `[โควต้าเต็มประจำเดือน] บริษัท ${quota.companyName} ใช้โควต้าแชตครบกำหนดของแพ็กเกจ ${quota.packageName} (${quota.monthlyLimit?.toLocaleString()} แชต) แล้วในรอบนี้`,
            resolution: `กรุณาอัปเกรดแพ็กเกจเพื่อขยายโควต้า หรือรอรอบบิลถัดไปในวันที่ ${new Date(quota.billingCycle.resetDate).toLocaleDateString('th-TH')}`
          })
          .eq('id', chat.id);
        return {
          status: 'quota_exceeded',
          chatId,
          companyId: chat.company_id,
          quota
        };
      }
    }

    // 2. Fetch available categories & training examples for the chat's company
    const categories = await getCategories(chat.company_id);
    const trainingExamples = await getTrainingExamples(chat.company_id);

    // 3. Layer 1 Dynamic Clause Segmentation + Layer 2 Triage Analysis (Qwen 2.5)
    const { clauses: preSegmentedClauses } = segmentConversationIntoClauses(chat.conversation);
    await waitForInteractiveIdle(`processSingleChat (${chatId}) - Qwen Triage`);
    const triage = await generateTriage(chat.conversation, categories, trainingExamples, preSegmentedClauses);
    
    // 4. Generate Embeddings (BGE-M3)
    await waitForInteractiveIdle(`processSingleChat (${chatId}) - BGE-M3 Embedding`);
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

    // 6. Layer 3: Validate & ensure complete atomic clause coverage
    const sanitizedDetectedIssues = (triage.detected_issues || []).map(iss => {
      const text = iss.problem_summary || iss.summary || '';
      const validated = sanitizeAndValidateIssueCategory(text, iss.category_id, categories);
      return {
        ...iss,
        category_id: validated.category_id,
        urgency: validated.isGuarded && validated.priority ? validated.priority : (iss.urgency || iss.priority || 'medium'),
        department: validated.isGuarded && validated.department ? validated.department : (iss.department || 'Support')
      };
    });

    let normalizedFinalIssues = [];
    if (sanitizedDetectedIssues.length > 0) {
      normalizedFinalIssues = sanitizedDetectedIssues.map(issue => ({
        chat_id: chat.id,
        category_id: issue.category_id,
        priority: issue.urgency || issue.priority || triage.priority || 'medium',
        department: issue.department || triage.department || 'Support',
        summary: issue.problem_summary || issue.summary || triage.summary || 'ไม่มีบทสรุป',
        recommended_reply: ''
      }));
    } else {
      normalizedFinalIssues = [{
        chat_id: chat.id,
        category_id: normalizeCategoryId(triage.category_id, categories),
        priority: triage.priority || 'medium',
        department: triage.department || 'Support',
        summary: triage.summary || 'ไม่มีบทสรุป',
        recommended_reply: ''
      }];
    }

    normalizedFinalIssues = await ensureCompleteSentenceCoverage(
      chat.conversation,
      normalizedFinalIssues,
      categories,
      chat.id,
      triage.priority || 'medium',
      triage.department || 'Support'
    );

    // 7. Update primary chat record & save multi-issue breakdown in Supabase
    const normalizedCategory = resolvePrimaryCategory(triage.category_id, normalizedFinalIssues, categories);
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

    console.log(`- Saving multi-issue breakdown (${normalizedFinalIssues.length} items) to Supabase...`);
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
export function normalizeCategoryId(id, categories) {
  if (!id || !categories || categories.length === 0) return null;
  // 1. Direct match
  if (categories.some(c => c.id === id)) return id;
  // 2. Suffix match (e.g. "deposit_withdrawal" matching "company_id:deposit_withdrawal")
  const suffix = id.split(':').pop().trim().toLowerCase();
  const suffixMatch = categories.find(c => {
    const cClean = (c.id || '').split(':').pop().trim().toLowerCase();
    return cClean === suffix || c.id.endsWith(`:${suffix}`) || c.id === suffix;
  });
  if (suffixMatch) return suffixMatch.id;
  // 3. Name match (case-insensitive)
  const nameMatch = categories.find(c => {
    const cName = (c.name || '').toLowerCase();
    return cName === id.toLowerCase() || cName.includes(suffix);
  });
  if (nameMatch) return nameMatch.id;
  // 4. Safe dynamic fallback to company's 'other' category, never arbitrary first category
  const otherMatch = categories.find(c => {
    const cClean = (c.id || '').split(':').pop().trim().toLowerCase();
    return cClean === 'other';
  });
  if (otherMatch) return otherMatch.id;
  return categories[0]?.id || null;
}

/**
 * Consistency Rule: Resolve the primary category for the top-level chat record.
 * Ensures the outer table's category strictly matches the highest priority / primary issue inside detected_issues.
 * @param {string} triageCategoryId - Category ID suggested by LLM top-level.
 * @param {any[]} detectedIssues - Array of detected sub-issues.
 * @param {any[]} categories - Company's categories list.
 * @returns {string} - Resolved category ID for chats.category_id.
 */
export function resolvePrimaryCategory(triageCategoryId, detectedIssues, categories) {
  if (Array.isArray(detectedIssues) && detectedIssues.length > 0) {
    const priorityWeight = { urgent: 4, high: 3, medium: 2, low: 1 };
    
    // Filter actual problem issues (exclude 'other' if problem issues exist)
    const problemIssues = detectedIssues.filter(iss => {
      const clean = (iss.category_id || '').split(':').pop().trim().toLowerCase();
      return clean !== 'other';
    });

    if (problemIssues.length > 0) {
      // Pick the problem issue with the highest urgency/priority
      const sorted = [...problemIssues].sort((a, b) => {
        const weightA = priorityWeight[(a.urgency || a.priority || 'medium').toLowerCase()] || 2;
        const weightB = priorityWeight[(b.urgency || b.priority || 'medium').toLowerCase()] || 2;
        return weightB - weightA;
      });
      return normalizeCategoryId(sorted[0].category_id, categories);
    }

    // If all issues are 'other' or non-problem inquiries, use the first issue
    return normalizeCategoryId(detectedIssues[0].category_id, categories);
  }

  return normalizeCategoryId(triageCategoryId, categories);
}
