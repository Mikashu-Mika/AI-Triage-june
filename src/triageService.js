import { supabase, getPendingChats, updateTriageResult, getCategories, findSimilarChats, getTrainingExamples, saveChatIssues } from './supabase.js';
import { generateTriage, getEmbedding } from './ollama.js';
import { logTriageAudit } from './triageLogger.js';
import { checkCompanyQuota } from './quotaService.js';
import { waitForInteractiveIdle } from './aiScheduler.js';

/**
 * Classify every pending chat (optionally for one company) one by one with processSingleChat,
 * so batch and real-time classification share exactly the same logic, persistence and audit log.
 * @param {string} [companyId]
 * @returns {Promise<{processedCount: number, successCount: number, failures: any[]}>}
 */
export async function runTriagePipeline(companyId) {
  console.log(`Starting Sift AI Pipeline for Company: ${companyId || 'Global'}...`);

  // 0. Quota Check: If company specified, check if monthly quota is exceeded
  if (companyId) {
    const quota = await checkCompanyQuota(companyId);
    if (quota.isExceeded) {
      const errMsg = `โควต้าแชตประจำเดือนเต็ม: บริษัท ${quota.companyName} ใช้โควต้าครบกำหนดของแพ็กเกจ ${quota.packageName} (${quota.monthlyLimit?.toLocaleString()} แชต) แล้วในรอบนี้`;
      console.warn(`⛔ [Pipeline Blocked] ${errMsg}`);
      throw new Error(errMsg);
    }
  }

  const pendingChats = await getPendingChats(companyId);
  console.log(`Found ${pendingChats.length} pending chats to process.`);

  const results = {
    processedCount: pendingChats.length,
    successCount: 0,
    failures: []
  };

  for (const chat of pendingChats) {
    const customerName = chat.customers?.name || 'Unknown customer';
    try {
      const outcome = await processSingleChat(chat.id);
      if (outcome?.status === 'quota_exceeded') {
        results.failures.push({ id: chat.id, customer_name: customerName, error: 'quota_exceeded' });
      } else {
        results.successCount++;
      }
    } catch (error) {
      results.failures.push({ id: chat.id, customer_name: customerName, error: error.message });
    }
  }

  console.log(`Sift AI Pipeline finished. Processed: ${results.processedCount}, Success: ${results.successCount}, Failures: ${results.failures.length}`);
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
      // For multi-turn conversations, if a turn is an elaboration/troubleshooting action for the preceding issue
      // (e.g. "ลองออกจากระบบแล้วเข้าใหม่ก็ยังเหมือนเดิม", "ลองรีเฟรชแล้วก็ยังเหมือนเดิม")
      // attach it to the preceding sentence rather than creating an isolated phantom login/other issue
      const isTroubleshootingContinuation = /^(ลอง(ออกจากระบบ|ล็อกอิน|รีเฟรช|เข้าใหม่|ทำใหม่|อีกรอบ|เปลี่ยนเครื่อง|สลับไปใช้).*(ก็ยังเหมือนเดิม|ก็ยังเป็นเหมือนเดิม|ยังเหมือนเดิม|ไม่หาย))$/i.test(turn.trim());
      if (isTroubleshootingContinuation && sentences.length > 0) {
        sentences[sentences.length - 1] += ` ${turn.trim()}`;
      } else {
        sentences.push(turn);
      }
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
      const isLlmOther = llmCatNormalized === otherCatId || llmCatNormalized.endsWith(':other');
      // If LLM said 'other' (non-problem), but Dynamic Vector detected a real problem category (similarity >= 0.55), do NOT keep 'other'!
      // For two competing real categories, require high confidence (>= 0.78) to override LLM.
      const overrideThreshold = isLlmOther ? 0.55 : 0.78;
      if (semanticMatch.similarity >= overrideThreshold && semanticMatch.category_id !== llmCatNormalized) {
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

    // Skip standalone closing pleas / call to action / non-issues when real technical issues are present in the conversation
    // (e.g. "ช่วยแก้ไขหน่อยค่ะ จะสั่งซื้อแต่ทำอะไรไม่ได้สักอย่าง", "ช่วยตรวจสอบระบบให้หน่อยค่ะ ไม่สามารถเช็กข้อมูลก่อนซื้อได้")
    const isClosingPlea = /^(ช่วย(ตรวจสอบ|แก้ไข|แก้|ดู|ปรับปรุง)|รบกวน(ช่วย)?(ตรวจสอบ|แก้ไข|แก้|ดู)|ฝาก(ดู|ตรวจสอบ|แก้ไข)).*(ระบบ|ให้หน่อย|หน่อย|ด้วย|ด่วน)?.*(ไม่สามารถ.*(ซื้อ|ดู|เช็ก|ใช้งาน|ทำอะไร)|จะสั่งซื้อแต่|ต้องการดูสินค้า|ทำอะไรไม่ได้สักอย่าง|ทำอะไรไม่ได้เลย)?.*(ค่ะ|ครับ|คะ|นะ|ด้วย)?$/i.test(item.summary) ||
      /^(ช่วย(แก้ไข|ตรวจสอบ|ดู).*(หน่อย|ด่วน|นะคะ|นะครับ|ด้วย))$/i.test(item.summary);
    const isOtherCat = (item.category_id || '').split(':').pop().trim().toLowerCase() === 'other';
    const hasRealTechnicalIssues = resolvedClauseIssues.some(iss => iss !== item && !iss.category_id.endsWith(':other') && !iss.category_id.endsWith(':feedback_complaint'));
    if ((isClosingPlea || isOtherCat) && hasRealTechnicalIssues) continue;

    // RULE: For non-defect chats (e.g. pure inquiry/context), preserve standalone 'other' category without monster consolidation
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
 * Run the full classification of one chat WITHOUT writing anything to the database
 * (used by processSingleChat and by the offline evaluation script).
 * @param {{ id: string, conversation: string, company_id?: string }} chat
 * @param {{ categories?: any[], trainingExamples?: any[] }} [context] - Pre-loaded company context (fetched when omitted).
 * @returns {Promise<{ triage: any, embedding: number[]|null, issues: any[], primary: { category_id: string, priority: string, department: string }, aiRecommendation: string }>}
 */
export async function classifyChat(chat, context = {}) {
  if (!chat.conversation) {
    throw new Error(`Chat conversation content is empty`);
  }

  const categories = context.categories || await getCategories(chat.company_id);
  const trainingExamples = context.trainingExamples || await getTrainingExamples(chat.company_id);

  // 1. Layer 1 clause segmentation + Layer 2 LLM classification
  const { clauses: preSegmentedClauses } = segmentConversationIntoClauses(chat.conversation);
  await waitForInteractiveIdle(`classifyChat (${chat.id}) - LLM`);
  const triage = await generateTriage(chat.conversation, categories, trainingExamples, preSegmentedClauses);

  // 2. Embedding of the summary + similar cases of the same company
  await waitForInteractiveIdle(`classifyChat (${chat.id}) - Embedding`);
  const embedding = await getEmbedding(triage.summary);
  const similarChats = await findSimilarChats(embedding, 0.70, 5, chat.company_id);
  let aiRecommendation = triage.ai_recommendation;
  const closest = similarChats.find(match => match.id !== chat.id);
  if (closest) {
    aiRecommendation = `[พบเคสที่คล้ายกัน ${(closest.similarity * 100).toFixed(1)}% ID: ${closest.id} - "${closest.summary}"]\n` + triage.ai_recommendation;
  }
  aiRecommendation = formatMultiIssuesRecommendation(triage, aiRecommendation);

  // 3. Layer 3: use the LLM category as-is (no keyword rule overrides; classification stays fully AI-driven)
  let issues = (triage.detected_issues || []).map(iss => {
    const text = iss.problem_summary || iss.summary || '';
    return {
      chat_id: chat.id,
      category_id: normalizeCategoryId(iss.category_id, categories),
      priority: iss.urgency || iss.priority || triage.priority || 'medium',
      department: iss.department || triage.department || 'Support',
      summary: text || triage.summary || 'ไม่มีบทสรุป',
      recommended_reply: ''
    };
  });
  if (issues.length === 0) {
    issues = [{
      chat_id: chat.id,
      category_id: normalizeCategoryId(triage.category_id, categories),
      priority: triage.priority || 'medium',
      department: triage.department || 'Support',
      summary: triage.summary || 'ไม่มีบทสรุป',
      recommended_reply: ''
    }];
  }
  issues = await ensureCompleteSentenceCoverage(
    chat.conversation,
    issues,
    categories,
    chat.id,
    triage.priority || 'medium',
    triage.department || 'Support'
  );

  // 4. Primary decision for the chats row = most severe real problem
  const primaryCategory = resolvePrimaryCategory(triage.category_id, issues, categories);
  const primaryIssue = issues.find(iss => iss.category_id === primaryCategory) || issues[0];

  return {
    triage,
    embedding,
    issues,
    aiRecommendation,
    primary: {
      category_id: primaryCategory,
      priority: primaryIssue?.priority || triage.priority || 'medium',
      department: primaryIssue?.department || triage.department || 'Support'
    }
  };
}

/**
 * Process a single chat session through the triage pipeline and persist the result.
 * @param {string} chatId - The ID of the chat.
 * @returns {Promise<{ status: string, chatId: string }>}
 */
export async function processSingleChat(chatId) {
  console.log(`Processing single chat ${chatId} in real-time...`);
  try {
    // 1. Fetch the specific chat
    const { data: chat, error: fetchErr } = await supabase
      .from('chats')
      .select('*, customers(*), chat_issues(id, is_human_verified)')
      .eq('id', chatId)
      .single();

    if (fetchErr || !chat) {
      throw new Error(`Chat ${chatId} not found in database: ${fetchErr?.message || ''}`);
    }

    // 1.1 Human-verified results (corrected in BO) are never overwritten by the AI
    if ((chat.chat_issues || []).some(iss => iss.is_human_verified)) {
      console.log(`🛡️ Chat ${chatId} has human-verified issues; skipping AI re-classification.`);
      await supabase.from('chats').update({ status: 'completed' }).eq('id', chatId);
      return { status: 'human_verified', chatId };
    }

    // 1.2 Quota Enforcement: Check if company has exceeded monthly chat quota
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

    // 2. Classify (LLM + embedding + rules), no writes yet
    const { triage, embedding, issues, aiRecommendation, primary } = await classifyChat(chat);

    // 3. Persist primary chat result & multi-issue breakdown
    await updateTriageResult(chat.id, {
      category_id: primary.category_id,
      priority: primary.priority,
      summary: triage.summary,
      embedding,
      sub_category: triage.sub_category,
      intent: triage.intent,
      root_cause: triage.root_cause,
      sentiment: triage.sentiment,
      urgency: triage.urgency,
      department: primary.department,
      keywords: triage.keywords,
      confidence: triage.confidence,
      recommended_reply: triage.recommended_reply,
      resolution: triage.resolution,
      business_impact: triage.business_impact,
      business_impact_score: triage.business_impact_score,
      ai_recommendation: aiRecommendation
    });

    console.log(`- Saving multi-issue breakdown (${issues.length} items) to Supabase...`);
    await saveChatIssues(chat.id, issues);

    // 4. Save detailed audit log to DB for full transparency
    await logTriageAudit(chatId, {
      companyId: chat.company_id,
      conversation: chat.conversation,
      llmResponse: triage,
      llmDetectedIssues: triage.detected_issues || [],
      sentenceBreakdown: issues,
      primaryDecision: {
        ...primary,
        urgency: triage.urgency,
        sentiment: triage.sentiment,
        root_cause: triage.root_cause,
        summary: triage.summary
      }
    });

    console.log(`Single chat ${chatId} processed successfully!`);
    return { status: 'completed', chatId };
  } catch (err) {
    console.error(`Error in processSingleChat for ${chatId}:`, err);
    // Mark as failed so the queue doesn't hang; keep the existing summary (an error message is not a chat summary)
    await supabase.from('chats').update({ status: 'failed' }).eq('id', chatId);
    throw err;
  }
}

/**
 * Helper to format multi-issue breakdowns from Sift AI classification into a readable list.
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
      // Prioritize concrete technical defects over generic feedback/complaint when both are present
      const technicalIssues = problemIssues.filter(iss => {
        const clean = (iss.category_id || '').split(':').pop().trim().toLowerCase();
        return clean !== 'feedback_complaint';
      });
      const candidateList = technicalIssues.length > 0 ? technicalIssues : problemIssues;

      // Pick the issue with the highest urgency/priority
      const sorted = [...candidateList].sort((a, b) => {
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
