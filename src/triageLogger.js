import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const AUDIT_LOG_FILE = path.join(LOG_DIR, 'triage_audit.log');

/**
 * Append formatted audit log to console and log file
 */
export function logTriageAudit(chatId, logData) {
  const timestamp = new Date().toISOString();
  const divider = '='.repeat(80);
  
  let output = `\n${divider}\n`;
  output += `🔍 [TRIAGE DIAGNOSTIC AUDIT LOG] - Chat ID: ${chatId} | Timestamp: ${timestamp}\n`;
  output += `${divider}\n`;

  if (logData.conversation) {
    output += `📜 [INPUT CONVERSATION]:\n${logData.conversation.split('\n').map(l => '  | ' + l).join('\n')}\n\n`;
  }

  if (logData.llmResponse) {
    output += `🤖 [OLLAMA QWEN 2.5 RAW JSON RESPONSE]:\n${JSON.stringify(logData.llmResponse, null, 2).split('\n').map(l => '  | ' + l).join('\n')}\n\n`;
  }

  if (logData.llmDetectedIssues && logData.llmDetectedIssues.length > 0) {
    output += `💡 [LLM DETECTED MULTI-ISSUES (${logData.llmDetectedIssues.length} items)]:\n`;
    logData.llmDetectedIssues.forEach((iss, idx) => {
      output += `  #${idx + 1} Issue: "${iss.problem_summary || iss.summary || '-'}"\n`;
      output += `     └─ Category: [${iss.category_id}] | Priority: [${iss.urgency || 'medium'}] | Dept: [${iss.department || 'Support'}]\n`;
    });
    output += `\n`;
  }

  if (logData.sentenceBreakdown && logData.sentenceBreakdown.length > 0) {
    output += `⚡ [SENTENCE-LEVEL DECISION TRACE (CHAT_ISSUES TABLE)]:\n`;
    logData.sentenceBreakdown.forEach((sb, idx) => {
      output += `  Line #${idx + 1}: "${sb.summary}"\n`;
      output += `     ├─ Matched Source: [${sb.source}]\n`;
      output += `     ├─ Assigned Category: [${sb.category_id}]\n`;
      output += `     ├─ Department: [${sb.department}]\n`;
      output += `     └─ Priority: [${sb.priority}]\n`;
    });
    output += `\n`;
  }

  if (logData.primaryDecision) {
    output += `🎯 [FINAL PRIMARY DECISION (CHATS TABLE)]:\n`;
    output += `  | Primary Category : ${logData.primaryDecision.category_id}\n`;
    output += `  | Priority / Urgency: ${logData.primaryDecision.priority} / ${logData.primaryDecision.urgency}\n`;
    output += `  | Department        : ${logData.primaryDecision.department}\n`;
    output += `  | Sentiment         : ${logData.primaryDecision.sentiment}\n`;
    output += `  | Root Cause        : ${logData.primaryDecision.root_cause}\n`;
    output += `  | Summary           : ${logData.primaryDecision.summary}\n`;
  }

  output += `${divider}\n`;

  // Print to stdout/console
  console.log(output);

  // Write to log file for permanent auditing
  try {
    fs.appendFileSync(AUDIT_LOG_FILE, output, 'utf8');
  } catch (err) {
    console.error('Failed to append to triage_audit.log:', err.message);
  }
}
