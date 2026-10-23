/**
 * Q&A Relevancy Audit Layer & Confidence Scoring Engine
 * Analyzes whether the generated AI response directly and accurately answers the user's query.
 * Assigns a Confidence Score from 1 to 10.
 */

import { findCategoryKeysByName, getCategoryDisplayName } from './categoryHelper.js';

export function calculateConfidenceScore(userQuery, toolUsed, rawData, replyText) {
  if (toolUsed === 'query_knowledge_base' || toolUsed === 'query_admin_response_time') {
    return 9;
  }
  let score = 9; // High baseline for clean database-backed queries
  const lowerQuery = (userQuery || '').toLowerCase();
  const lowerReply = (replyText || '').toLowerCase();

  // 1. Timeframe Consistency Check
  const asksForWeeks = lowerQuery.match(/(\d+)\s*(?:สัปดาห์|อาทิตย์)/i);
  const targetWeekDays = asksForWeeks ? parseInt(asksForWeeks[1], 10) * 7 : 0;

  const asksFor7Days = lowerQuery.includes('7 วัน') || lowerQuery.includes('7วัน') || lowerQuery.includes('ย้อนหลัง 7') || (asksForWeeks && targetWeekDays === 7);
  const asksFor2Days = lowerQuery.includes('2 วัน') || lowerQuery.includes('2วัน');
  const asksFor10Days = lowerQuery.includes('10 วัน') || lowerQuery.includes('10วัน');
  const asksFor15Days = lowerQuery.includes('15 วัน') || lowerQuery.includes('15วัน');
  const asksForToday = lowerQuery.includes('วันนี้');

  if (asksFor7Days && !lowerReply.includes('7 วัน') && !lowerReply.includes('1 สัปดาห์') && !lowerReply.includes('1สัปดาห์')) {
    score -= 3;
  } else if (asksFor2Days && !lowerReply.includes('2 วัน')) {
    score -= 3;
  } else if (asksFor10Days && !lowerReply.includes('10 วัน')) {
    score -= 3;
  } else if (asksFor15Days && !lowerReply.includes('15 วัน')) {
    score -= 3;
  } else if (asksForToday && lowerReply.includes('ย้อนหลัง 7 วัน')) {
    score -= 2;
  }

  // 2. Specific Category Query Check (100% Dynamic via Category Resolution)
  const asksForPercentage = lowerQuery.includes('เปอร์เซ็นต์') || lowerQuery.includes('เปอร์เซนต์') || lowerQuery.includes('%') || lowerQuery.includes('คิดเป็น') || lowerQuery.includes('สัดส่วน') || lowerQuery.includes('กี่เปอร์');

  if (asksForPercentage && !lowerReply.includes('%') && !lowerReply.includes('เปอร์เซ็นต์')) {
    score -= 4; // Severe penalty if percentage query doesn't receive percentage stats
  }

  const queryCategories = findCategoryKeysByName(lowerQuery) || [];
  if (queryCategories.length > 0) {
    const isZeroMatchReply = lowerReply.includes('0 กรณี') || lowerReply.includes('ไม่พบรายการปัญหา') || lowerReply.includes('ไม่พบรายงานปัญหา');
    if (!isZeroMatchReply) {
      const mentionsAnyTargetCat = queryCategories.some(catKey => {
        const catNameTH = (getCategoryDisplayName(catKey) || '').toLowerCase();
        const cleanKey = catKey.toLowerCase();
        return lowerReply.includes(cleanKey) ||
               (catNameTH && lowerReply.includes(catNameTH)) ||
               (cleanKey === 'registration' && lowerReply.includes('สมัคร')) ||
               (cleanKey === 'deposit_withdrawal' && (lowerReply.includes('ฝาก') || lowerReply.includes('ถอน'))) ||
               (cleanKey === 'payment_gateway' && (lowerReply.includes('ชำระเงิน') || lowerReply.includes('ธนาคาร'))) ||
               (cleanKey === 'login_issue' && (lowerReply.includes('เข้าสู่ระบบ') || lowerReply.includes('ล็อกอิน'))) ||
               (cleanKey === 'page_load_freeze' && (lowerReply.includes('ค้าง') || lowerReply.includes('โหลดช้า'))) ||
               (cleanKey === 'feedback_complaint' && (lowerReply.includes('ร้องเรียน') || lowerReply.includes('แอดมิน')));
      });

      if (!mentionsAnyTargetCat) {
        score -= 3;
      }
    }
  }

  // 3. Payload Integrity Check
  if (!rawData || (typeof rawData === 'object' && Object.keys(rawData).length === 0)) {
    score -= 3;
  }

  // 4. Zero-match Fallback Check (Synthesizer gives accurate 0 case info + top categories = confidence 8-9)
  if (rawData && rawData.matched_issues_count === 0 && lowerReply.includes('0 กรณี')) {
    if (score < 8) score = 8;
  }

  // 5. Specific Topic/Keyword Relevancy Audit
  // If query asks for specific custom topic terms (e.g. 'หวย', 'เลขเด็ด', 'ห้องหวย', 'สลิป', 'อายัด', 'โบนัสวันเกิด')
  // but response returns a generic overall summary card without addressing the topic or returning zero-match statement
  const hasSpecificTopicQuery = lowerQuery.includes('หวย') || lowerQuery.includes('เลขเด็ด') || lowerQuery.includes('ห้องหวย') || lowerQuery.includes('สลิป') || lowerQuery.includes('อายัด') || lowerQuery.includes('วันเกิด');
  
  if (hasSpecificTopicQuery) {
    const isGenericSummaryCard = lowerReply.includes('สรุปปัญหาแชท') && lowerReply.includes('หมวดหมู่ปัญหาที่พบมากที่สุด');
    const mentionsTopic = lowerReply.includes('หวย') || lowerReply.includes('เลขเด็ด') || lowerReply.includes('ห้องหวย') || lowerReply.includes('สลิป') || lowerReply.includes('อายัด') || lowerReply.includes('วันเกิด') || lowerReply.includes('ไม่พบข้อมูลตามเงื่อนไขที่ค้นหา');

    if (isGenericSummaryCard && !mentionsTopic) {
      score -= 5; // Severe penalty for dumping generic summary card on a specific topic query
    }
  }

  // Clamp score strictly between 1 and 10
  return Math.max(1, Math.min(10, score));
}

/**
 * Perform deep audit on Q&A relevancy
 * @param {string} userQuery
 * @param {string} replyText
 * @param {string} toolUsed
 * @param {object} rawData
 * @returns {object} Audit result with isRelevant, confidence score, and missingCriteria
 */
export function auditAnswerRelevancy(userQuery, replyText, toolUsed, rawData) {
  if (toolUsed === 'query_knowledge_base' || toolUsed === 'query_admin_response_time') {
    return {
      isRelevant: true,
      confidence: 9,
      reasoning: 'Audit PASSED: High confidence (9/10). Direct Knowledge Base SOP guidance or Admin Response Time SLA answered successfully.',
      missingCriteria: []
    };
  }
  const confidence = calculateConfidenceScore(userQuery, toolUsed, rawData, replyText);
  const lowerQuery = (userQuery || '').toLowerCase();
  const lowerReply = (replyText || '').toLowerCase();

  const missingCriteria = [];

  // Timeframe mismatch detection
  if ((lowerQuery.includes('7 วัน') || lowerQuery.includes('ย้อนหลัง 7')) && !lowerReply.includes('7 วัน')) {
    missingCriteria.push('timeframe_mismatch_7days');
  }
  if ((lowerQuery.includes('2 วัน') || lowerQuery.includes('ย้อนหลัง 2')) && !lowerReply.includes('2 วัน')) {
    missingCriteria.push('timeframe_mismatch_2days');
  }

  // Category mismatch detection (Dynamic)
  const auditTargetCats = findCategoryKeysByName(lowerQuery) || [];
  if (auditTargetCats.length > 0) {
    const isZeroMatchReply = lowerReply.includes('0 กรณี') || lowerReply.includes('ไม่พบรายการปัญหา') || lowerReply.includes('ไม่พบรายงานปัญหา');
    if (!isZeroMatchReply) {
      const mentionsAny = auditTargetCats.some(catKey => {
        const catNameTH = (getCategoryDisplayName(catKey) || '').toLowerCase();
        const cleanKey = catKey.toLowerCase();
        return lowerReply.includes(cleanKey) ||
               (catNameTH && lowerReply.includes(catNameTH)) ||
               (cleanKey === 'registration' && lowerReply.includes('สมัคร')) ||
               (cleanKey === 'deposit_withdrawal' && (lowerReply.includes('ฝาก') || lowerReply.includes('ถอน'))) ||
               (cleanKey === 'payment_gateway' && (lowerReply.includes('ชำระเงิน') || lowerReply.includes('ธนาคาร'))) ||
               (cleanKey === 'login_issue' && (lowerReply.includes('เข้าสู่ระบบ') || lowerReply.includes('ล็อกอิน'))) ||
               (cleanKey === 'page_load_freeze' && (lowerReply.includes('ค้าง') || lowerReply.includes('โหลดช้า'))) ||
               (cleanKey === 'feedback_complaint' && (lowerReply.includes('ร้องเรียน') || lowerReply.includes('แอดมิน')));
      });
      if (!mentionsAny) {
        missingCriteria.push(`category_mismatch_${auditTargetCats.join('_')}`);
      }
    }
  }

  // Topic keyword mismatch detection
  const hasSpecificTopicQuery = lowerQuery.includes('หวย') || lowerQuery.includes('เลขเด็ด') || lowerQuery.includes('ห้องหวย') || lowerQuery.includes('สลิป') || lowerQuery.includes('อายัด') || lowerQuery.includes('วันเกิด');
  if (hasSpecificTopicQuery) {
    const isGenericSummaryCard = lowerReply.includes('สรุปปัญหาแชท') && lowerReply.includes('หมวดหมู่ปัญหาที่พบมากที่สุด');
    const mentionsTopic = lowerReply.includes('หวย') || lowerReply.includes('เลขเด็ด') || lowerReply.includes('ห้องหวย') || lowerReply.includes('สลิป') || lowerReply.includes('อายัด') || lowerReply.includes('วันเกิด') || lowerReply.includes('ไม่พบข้อมูลตามเงื่อนไขที่ค้นหา');

    if (isGenericSummaryCard && !mentionsTopic) {
      missingCriteria.push('topic_keyword_unanswered_fallback_card_detected');
    }
  }

  const isRelevant = confidence >= 7 && missingCriteria.length === 0;

  return {
    isRelevant,
    confidence,
    reasoning: isRelevant 
      ? `Audit PASSED: High confidence (${confidence}/10). Direct query-to-answer relevancy confirmed.` 
      : `Audit FLAGGED: Low confidence (${confidence}/10). Missing criteria: ${missingCriteria.join(', ')}`,
    missingCriteria
  };
}
