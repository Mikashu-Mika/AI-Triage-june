import { supabase } from './supabase.js';

/**
 * Save the classification decision trace of a chat to the classification_audit_logs table (and echo a short line to console).
 * Never throws: an audit log failure must not fail the classification itself.
 * @param {string} chatId
 * @param {object} logData - { companyId, conversation, llmResponse, llmDetectedIssues, sentenceBreakdown, primaryDecision }
 */
export async function logTriageAudit(chatId, logData) {
  const primary = logData.primaryDecision || {};
  console.log(`🔍 [Classification Audit] Chat ${chatId} -> ${primary.category_id} (${primary.priority}), ${(logData.sentenceBreakdown || []).length} issues`);

  try {
    const { error } = await supabase.from('classification_audit_logs').insert([{
      chat_id: chatId,
      company_id: logData.companyId || null,
      conversation: logData.conversation || null,
      llm_response: logData.llmResponse || null,
      llm_detected_issues: logData.llmDetectedIssues || [],
      sentence_breakdown: (logData.sentenceBreakdown || []).map(sb => ({
        summary: sb.summary,
        source: sb.source,
        category_id: sb.category_id,
        department: sb.department,
        priority: sb.priority
      })),
      primary_decision: primary
    }]);
    if (error) console.error('⚠️ [Supabase classification_audit_logs Error]:', error.message);
  } catch (err) {
    console.error('⚠️ [Supabase classification_audit_logs Exception]:', err.message);
  }
}
