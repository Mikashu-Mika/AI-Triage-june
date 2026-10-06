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

      const normalizedCategory = resolvePrimaryCategory(triage.category_id, sanitizedDetectedIssues, categories);
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
      let normalizedIssues = sanitizedDetectedIssues.map(iss => ({
        chat_id: chat.id,
        category_id: iss.category_id,
        priority: iss.urgency || iss.priority || triage.priority || 'medium',
        department: iss.department || triage.department || 'Support',
        summary: iss.problem_summary || iss.summary || triage.summary || 'ไม่มีบทสรุป',
        recommended_reply: iss.recommended_reply || triage.recommended_reply || ''
      }));
      normalizedIssues = await ensureCompleteSentenceCoverage(chat.conversation, normalizedIssues, categories, chat.id);
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

  // Guard 1: OTP / SMS / Notification failure rule
  // Even if user mentions registration or login context (e.g. "ตอนนี้สมัครได้ไหม ทำไม otp ไม่มา", "otp ไม่ส่ง")
  const isOtpIssue = /(otp|โอทีพี|sms).*(ไม่มา|ไม่เข้า|ไม่ส่ง|ไม่ได้|ไม่ได้รับ|ช้า)|(ไม่ได้รับ|ไม่ส่ง|ไม่ได้).*(otp|โอทีพี|sms)/i.test(cleanText);
  if (isOtpIssue) {
    const notifCat = categories.find(c => c.id.endsWith(':notification_issue') || c.id === 'notification_issue');
    if (notifCat) {
      return { category_id: notifCat.id, priority: 'high', department: 'Support', isGuarded: true };
    }
  }

  // Guard 2: Account security / change sensitive info (bank account, phone number, password, credentials)
  // e.g. "เปลี่ยนบัญชีธนาคารให้หน่อย", "ขอเปลี่ยนเลขบัญชี", "เปลี่ยนเบอร์โทรศัพท์", "แก้บัญชีธนาคาร", "ผูกบัญชีใหม่"
  const isBankOrSecurityChange = /(เปลี่ยน|แก้|ย้าย|อัปเดต|ขอเปลี่ยน|ขอแก้).*(บัญชีธนาคาร|เลขบัญชี|สมุดบัญชี|เบอร์โทร|เบอร์ศัพท์)|(ขอเปลี่ยน|ขอแก้).*(บัญชี|เบอร์)/i.test(cleanText);
  if (isBankOrSecurityChange) {
    const secCat = categories.find(c => c.id.endsWith(':account_security') || c.id === 'account_security');
    if (secCat) {
      return { category_id: secCat.id, priority: 'high', department: 'Support', isGuarded: true };
    }
  }

  // Guard 3: Access blocked / broken links
  // e.g. "ขอลิงก์หน้าฝากหน่อย ลิงก์เดิมฝากไม่ได้", "ลิงก์เข้าเล่นเป็นอะไร", "เข้าเว็บไม่ได้"
  const isAccessBlocked = /(ขอลิงก์|ขอลิ้ง|ขอเว็บ).*(ใหม่|สำรอง|เดิม|ไม่ได้|เข้าไม่ได้)|(ลิงก์|ลิ้ง|link|เว็บ|หน้าเว็บ).*(เป็นอะไร|เข้าไม่ได้|เสีย|พัง|เปิดไม่ติด|โหลดไม่ขึ้น|error)/i.test(cleanText);
  if (isAccessBlocked) {
    const accessCat = categories.find(c => c.id.endsWith(':access_blocked') || c.id === 'access_blocked');
    if (accessCat) {
      return { category_id: accessCat.id, priority: 'medium', department: 'Support', isGuarded: true };
    }
  }

  // Guard 4: Button response lag / multiple clicks
  // e.g. "กดหลายครั้งระบบถึงเลือกให้", "ปุ่มไม่ตอบสนอง", "กดแล้วไม่ไป"
  const isButtonLag = /(กดหลายครั้ง|กดซ้ำ|กดแล้วไม่ไป|ปุ่มไม่ตอบสนอง|ตอบสนองช้า|ไม่ตอบสนอง|กว่าจะเลือกได้|กว่าจะติด|ระบบถึงเลือกให้)/i.test(cleanText);
  if (isButtonLag) {
    const lagCat = categories.find(c => c.id.endsWith(':interaction_lag') || c.id === 'interaction_lag');
    if (lagCat) {
      return { category_id: lagCat.id, priority: 'medium', department: 'Support', isGuarded: true };
    }
  }

  // Guard 5: Deposit / Withdrawal issue
  // e.g. "ถอนเมื่อวาน 35,000 ให้หน่อย เงินยังไม่เข้าบัญชี", "ฝากเงินไม่เข้า"
  const isDepositWithdrawal = /(ถอน|ฝาก|โอน).*(ไม่เข้า|ช้า|ดีเลย์|ยังไม่ได้|หาย|ไม่อัปเดต|ค้าง)/i.test(cleanText);
  if (isDepositWithdrawal) {
    const depCat = categories.find(c => c.id.endsWith(':deposit_withdrawal') || c.id === 'deposit_withdrawal');
    if (depCat) {
      return { category_id: depCat.id, priority: 'high', department: 'Support', isGuarded: true };
    }
  }

  // Guard 6: Refresh page / display update
  const isRefreshIssue = /(รีเฟรช|refresh).*(ถึงจะเห็น|ถึงจะขึ้น|ถึงจะอัปเดต)/i.test(cleanText);
  if (isRefreshIssue) {
    const freezeCat = categories.find(c => c.id.endsWith(':page_load_freeze') || c.id === 'page_load_freeze');
    if (freezeCat) {
      return { category_id: freezeCat.id, priority: 'medium', department: 'Support', isGuarded: true };
    }
  }

  // Guard 7: General context or inquiries without problems -> other
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
 * Dynamically classify a sentence using BGE-M3 Vector Semantic Matching against categories in Supabase.
 * @param {string} text - The sentence/text to classify.
 * @param {any[]} categories - Available dynamic categories for the company (with embeddings).
 * @param {string} mainCategory - The main category identified for the conversation.
 * @returns {Promise<{ category_id: string, similarity: number, source: string }>}
 */
export async function classifySentenceSemantic(text, categories = [], mainCategory = 'other') {
  if (!text || !categories || categories.length === 0) {
    return { category_id: mainCategory || 'other', similarity: 0, source: 'Fallback' };
  }

  const cleanText = text.trim();

  // Deterministic rule check
  const ruleCheck = sanitizeAndValidateIssueCategory(cleanText, null, categories);
  if (ruleCheck && ruleCheck.isGuarded) {
    return {
      category_id: ruleCheck.category_id,
      similarity: 1.0,
      source: 'Deterministic Rule Guard'
    };
  }

  try {
    // Generate embedding for the sentence using local BGE-M3 model
    const sentenceVector = await getEmbedding(cleanText);
    if (!sentenceVector || sentenceVector.length === 0) {
      return { category_id: mainCategory || 'other', similarity: 0, source: 'Fallback' };
    }

    // Rank categories dynamically by cosine similarity against categories.embedding in Supabase
    const scoredCategories = categories
      .filter(c => c.embedding)
      .map(c => {
        const catEmbedding = typeof c.embedding === 'string' ? JSON.parse(c.embedding) : c.embedding;
        const sim = cosineSimilarity(sentenceVector, catEmbedding);
        return { category_id: c.id, name: c.name, similarity: sim };
      })
      .sort((a, b) => b.similarity - a.similarity);

    // Require high semantic confidence (>= 0.68) to prevent false positives from generic words
    if (scoredCategories.length > 0 && scoredCategories[0].similarity >= 0.68) {
      return {
        category_id: scoredCategories[0].category_id,
        similarity: scoredCategories[0].similarity,
        source: 'Vector Semantic Engine (BGE-M3)'
      };
    }
  } catch (err) {
    console.warn(`Vector semantic matching error for "${cleanText}":`, err.message);
  }

  // Safe dynamic fallback to company's 'other' category for non-matching or general sentences
  const otherCat = categories.find(c => c.id.endsWith(':other') || c.id === 'other');
  return { category_id: otherCat ? otherCat.id : 'other', similarity: 0, source: 'Dynamic Non-Problem Fallback' };
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
 * Ensures all individual customer lines from the conversation are represented in chat_issues.
 * If the LLM omitted non-problem context (e.g. "ผมกำลังเลือกน้ำหอมอยู่ครับ" or "รีเฟรชแล้วกลับมาใช้งานได้ครับ"),
 * this automatically adds them with category_id 'other' and priority 'low' so the frontend modal
 * doesn't trigger its fallback and misclassify them as technical defects.
 */
export async function ensureCompleteSentenceCoverage(conversation, detectedIssues, categories, chatId) {
  if (!conversation) return detectedIssues || [];

  // Extract individual customer lines
  const lines = conversation
    .split('\n')
    .map(line => line.replace(/^(ลูกค้า|ผู้ใช้|แอดมิน|เจ้าหน้าที่|User|Customer|Admin):\s*/i, '').trim())
    .filter(line => line.length > 0);

  const finalIssues = [...(detectedIssues || [])];
  const otherCatObj = categories.find(c => c.id.endsWith(':other') || c.id === 'other');
  const otherCatId = otherCatObj ? otherCatObj.id : 'other';

  for (const line of lines) {
    // Check if this line is already represented in any existing issue summary (exact or paraphrased)
    let matchingIssue = finalIssues.find(iss => {
      const s = (iss.summary || '').toLowerCase();
      const l = line.toLowerCase();
      if (s.includes(l) || l.includes(s)) return true;
      return calculateTextSimilarity(l, s) >= 0.65;
    });

    if (matchingIssue) {
      // Synchronize summary to the customer's verbatim text so UI shows exact original wording
      matchingIssue.summary = line;
      // Re-verify category guard on matching issue summary
      const guarded = sanitizeAndValidateIssueCategory(line, matchingIssue.category_id, categories);
      if (guarded.isGuarded) {
        matchingIssue.category_id = guarded.category_id;
        if (guarded.priority) matchingIssue.priority = guarded.priority;
        if (guarded.department) matchingIssue.department = guarded.department;
      }
    } else {
      console.log(`- Missing line from LLM detected_issues: "${line}". Adding dynamic coverage...`);
      // Classify missing line dynamically using vector similarity & rule guards
      const semanticMatch = await classifySentenceSemantic(line, categories, otherCatId);
      const isOther = semanticMatch.category_id === otherCatId || semanticMatch.category_id.endsWith(':other');
      
      finalIssues.push({
        chat_id: chatId,
        category_id: semanticMatch.category_id || otherCatId,
        priority: isOther ? 'low' : 'medium',
        department: isOther ? 'Support' : 'Developer',
        summary: line,
        recommended_reply: ''
      });
    }
  }

  // Preserve line order matching the conversation
  finalIssues.sort((a, b) => {
    const idxA = lines.findIndex(l => (a.summary || '').includes(l) || l.includes(a.summary || ''));
    const idxB = lines.findIndex(l => (b.summary || '').includes(l) || l.includes(b.summary || ''));
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });

  return finalIssues;
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

    const normalizedCategory = resolvePrimaryCategory(triage.category_id, sanitizedDetectedIssues, categories);
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

    // 7. Save multi-issue breakdown (Qwen 2.5 14B) to chat_issues table
    console.log(`- Saving multi-issue breakdown from Qwen 2.5 to Supabase...`);
    
    let normalizedFinalIssues = [];
    if (sanitizedDetectedIssues.length > 0) {
      normalizedFinalIssues = sanitizedDetectedIssues.map(issue => ({
        chat_id: chat.id,
        category_id: issue.category_id,
        priority: issue.urgency || issue.priority || triage.priority || 'medium',
        department: issue.department || triage.department || 'Support',
        summary: issue.problem_summary || issue.summary || triage.summary || 'ไม่มีบทสรุป',
        recommended_reply: issue.recommended_reply || triage.recommended_reply || ''
      }));
    } else {
      normalizedFinalIssues = [{
        chat_id: chat.id,
        category_id: normalizedCategory,
        priority: triage.priority || 'medium',
        department: triage.department || 'Support',
        summary: triage.summary || 'ไม่มีบทสรุป',
      }];
    }

    normalizedFinalIssues = await ensureCompleteSentenceCoverage(chat.conversation, normalizedFinalIssues, categories, chat.id);
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
