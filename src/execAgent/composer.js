/**
 * Turns tool facts into the Telegram reply.
 * The LLM writes the wording, but every number in its reply must exist in the facts; otherwise the
 * deterministic formatter below is used, so the bot never presents invented figures.
 */
import { ollamaChat, stripForeignScripts } from './llm.js';

const UNSUPPORTED_REPLIES = {
  money_amounts: 'ระบบยังไม่มีข้อมูลยอดเงิน/ยอดฝาก-ถอน/ธุรกรรมทางการเงิน จึงตอบส่วนนี้ไม่ได้ค่ะ',
  slips: 'ระบบยังไม่มีข้อมูลสลิปโอนเงิน จึงตอบส่วนนี้ไม่ได้ค่ะ',
  campaigns: 'ระบบยังไม่มีข้อมูลแคมเปญหรือช่องทางการตลาด จึงตอบส่วนนี้ไม่ได้ค่ะ',
  admin_response_time: 'ระบบยังไม่มีข้อมูลเวลาที่แอดมินตอบแชต (SLA) จึงตอบส่วนนี้ไม่ได้ค่ะ',
  personal_data: 'ขออภัยค่ะ ไม่สามารถเปิดเผยข้อมูลติดต่อส่วนตัวของลูกค้า (เบอร์โทร/อีเมล/รหัสผ่าน) ตามนโยบายความปลอดภัยค่ะ',
  out_of_scope: 'เรื่องนี้อยู่นอกขอบเขตข้อมูลของระบบค่ะ'
};

const CAPABILITIES = 'สถิติและรายการปัญหาจากแชตลูกค้า (แยกหมวด/ความด่วน/ช่วงเวลา), เปรียบเทียบช่วงเวลา, ข้อมูลลูกค้าใหม่/ลูกค้าเก่า, ค้นหาแชตตามหัวข้อ, อารมณ์ลูกค้า และแนวทางแก้ปัญหาตามคู่มือ';

export function unsupportedText(topics) {
  return topics.map(t => `- ${UNSUPPORTED_REPLIES[t] || UNSUPPORTED_REPLIES.out_of_scope}`).join('\n');
}

// ---------------------------------------------------------------------------
// Deterministic formatters (fallback + guaranteed-correct numbers)
// ---------------------------------------------------------------------------
function formatIssueStats(f) {
  const lines = [`📊 *${f.filters.categories.length ? `ปัญหาหมวด ${f.filters.categories.join(' / ')}` : 'สรุปปัญหา'}* — ${f.period.label}`];
  lines.push(`- แชตทั้งหมด: ${f.total_chats_in_period} แชต`);
  if (f.filters.categories.length || f.filters.priorities.length) {
    lines.push(`- ปัญหาที่ตรงเงื่อนไข: ${f.matched_problem_issues} กรณี จาก ${f.matched_chats} แชต (${f.pct_of_all_problems}% ของปัญหาทั้งหมด ${f.total_problem_issues_in_period} กรณี)`);
  } else {
    lines.push(`- ปัญหาที่พบ: ${f.matched_problem_issues} กรณี จาก ${f.matched_chats} แชต`);
  }
  if (f.groups.length) {
    lines.push('', f.group_by === 'hour' ? '⏰ *ช่วงเวลาที่พบมากที่สุด*' : f.group_by === 'day' ? '📅 *วันที่พบมากที่สุด*' : f.group_by === 'priority' ? '🚦 *แยกตามความด่วน*' : '📌 *หมวดที่พบมากที่สุด*');
    f.groups.slice(0, 5).forEach((g, i) => lines.push(`${i + 1}. ${g.group} — ${g.issues} กรณี (${g.pct_of_matched_issues}%)`));
  } else {
    lines.push('', 'ไม่พบปัญหาตามเงื่อนไขในช่วงเวลานี้ค่ะ');
  }
  return lines.join('\n');
}

function formatChatList(f) {
  const title = f.tool === 'search_chats' ? `🔎 *ผลค้นหา "${f.query}"*` : '📋 *รายการแชต*';
  const total = f.tool === 'search_chats' ? f.total_matches : f.total_matched_chats;
  const lines = [`${title} — ${f.period.label}`, `- พบ ${total} แชต${total > f.shown ? ` (แสดง ${f.shown} รายการ)` : ''}`];
  if (!f.items?.length) return [...lines, '', 'ไม่พบแชตตามเงื่อนไขค่ะ'].join('\n');
  lines.push('');
  f.items.forEach((it, i) => {
    const summary = it.issues?.[0]?.summary || it.chat_summary || '-';
    lines.push(`${i + 1}. \`${it.chat_id}\` (${it.time}, ความด่วน${it.priority}) ${it.categories.join(', ')}`);
    lines.push(`   "${summary.slice(0, 140)}"`);
  });
  if (f.excel_export) lines.push('', '📎 ส่งไฟล์ Excel รายการทั้งหมดให้ด้านล่างค่ะ');
  return lines.join('\n');
}

function formatCompare(f) {
  const lines = [`📅 *เปรียบเทียบ${f.metric_th}*`];
  lines.push(`- ${f.period_a.label}: ${f.period_a.value} (เฉลี่ย ${f.period_a.per_day}/วัน)`);
  lines.push(`- ${f.period_b.label}: ${f.period_b.value} (เฉลี่ย ${f.period_b.per_day}/วัน)`);
  lines.push(`- ส่วนต่าง: ${f.diff > 0 ? '+' : ''}${f.diff}${f.pct_change !== null ? ` (${f.pct_change > 0 ? '+' : ''}${f.pct_change}%)` : ''}`);
  if (f.period_a.is_partial) lines.push(`- หมายเหตุ: ${f.period_a.label} ยังไม่ครบช่วง (${f.period_a.days} วัน) ควรดูค่าเฉลี่ยต่อวันประกอบ`);
  if (f.biggest_category_changes?.length) {
    lines.push('', '📌 *หมวดที่เปลี่ยนแปลงมากที่สุด*');
    f.biggest_category_changes.forEach(c => lines.push(`- ${c.category}: ${c.previous} → ${c.current}`));
  }
  return lines.join('\n');
}

function formatCustomers(f) {
  const lines = [`👥 *ข้อมูลลูกค้า* — ${f.period.label}`, `- ลูกค้าทั้งหมดในระบบ: ${f.total_customers} คน`, `- ลูกค้าใหม่ในช่วงนี้: ${f.new_customers_in_period} คน`];
  if (f.new_customers) f.new_customers.forEach((c, i) => lines.push(`${i + 1}. ${c.name} (\`${c.customer_id}\`) สมัคร ${c.registered_at}`));
  if (f.by_month) f.by_month.forEach(m => lines.push(`- ${m.month}: ${m.count} คน`));
  if (f.repeat_customers) {
    lines.push(`- ลูกค้าที่ทักมากกว่า 1 ครั้ง: ${f.customers_with_multiple_chats} คน (แจ้งปัญหาหมวดเดิมซ้ำ ${f.customers_repeating_same_problem} คน)`);
    f.repeat_customers.slice(0, 10).forEach(r => lines.push(`- ${r.name} (\`${r.customer_id}\`) ${r.chats} แชต${r.repeated_problems.length ? ` ซ้ำเรื่อง: ${r.repeated_problems.join(', ')}` : ''}`));
  }
  if (f.pct_existing !== undefined) {
    lines.push(`- แชตจากลูกค้าเก่า: ${f.chats_from_existing_customers} จาก ${f.chats_in_period} แชต (${f.pct_existing}%)`, `- ${f.definition}`);
  }
  return lines.join('\n');
}

function formatSentiment(f) {
  const lines = [`😊 *อารมณ์ลูกค้า* — ${f.period.label}`, `- แชตทั้งหมด: ${f.total_chats} แชต`];
  f.polarity.forEach(p => lines.push(`- เชิง${p.group}: ${p.count} แชต (${p.pct}%)`));
  if (f.positive_examples?.length) {
    lines.push('', '💖 *ตัวอย่างแชตเชิงบวก/คำชม*');
    f.positive_examples.forEach(e => lines.push(`- \`${e.chat_id}\` (${e.sentiment}) ${String(e.summary || '').slice(0, 120)}`));
  }
  if (f.negative_examples.length) {
    lines.push('', '📌 *ตัวอย่างแชตเชิงลบ*');
    f.negative_examples.forEach(e => lines.push(`- \`${e.chat_id}\` (${e.sentiment}) ${String(e.summary || '').slice(0, 120)}`));
  }
  return lines.join('\n');
}

function formatCategoryInfo(f) {
  if (!f.category) return `ไม่พบหมวดที่ถามค่ะ หมวดที่มีในระบบ: ${(f.available_categories || []).map(c => c.name).join(', ')}`;
  const lines = [`📖 *${f.category.name}*`, f.category.description ? `- ครอบคลุม: ${f.category.description}` : ''];
  if (f.sop) lines.push('', `🛠️ *คู่มือ (${f.sop.status})*`, f.sop.content);
  return lines.filter(Boolean).join('\n');
}

function formatAdvice(f) {
  if (f.no_problems_found) return `ไม่พบปัญหาใน${f.period.label} จึงยังไม่มีแนวทางแก้ที่ต้องแนะนำค่ะ`;
  const lines = [`🛠️ *แนวทางแก้ปัญหา "${f.category.name}"* — ${f.period.label}`];
  lines.push(`- พบ ${f.issues_in_period} กรณี จาก ${f.chats_in_period} แชต (${f.previous_period.label}: ${f.previous_period.issues} กรณี)`);
  if (f.peak_hours.length) lines.push(`- ช่วงเวลาที่พบมาก: ${f.peak_hours.map(h => `${h.hour} (${h.issues})`).join(', ')}`);
  if (f.example_chats.length) lines.push(`- แชตตัวอย่าง: ${f.example_chats.map(id => `\`${id}\``).join(', ')}`);
  if (f.sop) lines.push('', `📘 *จากคู่มือ (${f.sop.status})*`, f.sop.content);
  else lines.push('', 'ℹ️ ยังไม่มีคู่มือแก้ปัญหาสำหรับหมวดนี้ในระบบค่ะ');
  return lines.join('\n');
}

const FORMATTERS = {
  get_issue_stats: formatIssueStats,
  list_chats: formatChatList,
  search_chats: formatChatList,
  compare_periods: formatCompare,
  get_customer_stats: formatCustomers,
  get_sentiment: formatSentiment,
  get_category_info: formatCategoryInfo,
  get_resolution_advice: formatAdvice
};

export function formatDeterministic(results, unsupportedTopics = []) {
  const parts = results.map(r => r.error ? `⚠️ ดึงข้อมูลส่วนนี้ไม่สำเร็จ: ${r.error}` : (FORMATTERS[r.tool]?.(r) || ''));
  if (unsupportedTopics.length) parts.push(unsupportedText(unsupportedTopics));
  return parts.filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// LLM composition with number grounding check
// ---------------------------------------------------------------------------
const numbersIn = text => (String(text).match(/\d+(?:[.,]\d+)*/g) || []).map(n => n.replace(/,/g, ''));

/**
 * Every number in the reply must appear in the facts or the question
 * (small integers are allowed for list numbering).
 */
export function numbersAreGrounded(reply, facts, query) {
  const allowed = new Set([...numbersIn(JSON.stringify(facts)), ...numbersIn(query)]);
  // Allow "45.0" vs "45", and the same number without decimals
  for (const n of [...allowed]) {
    if (n.includes('.')) allowed.add(String(parseFloat(n)));
  }
  return numbersIn(reply).every(n => allowed.has(n) || allowed.has(String(parseFloat(n))) || (/^\d+$/.test(n) && parseInt(n, 10) <= 20));
}

function compactFacts(results) {
  // Drop bulky fields the writer does not need
  return results.map(r => {
    const { excel_export, ...rest } = r;
    return excel_export ? { ...rest, excel_file_attached: true, excel_rows: excel_export.items.length } : rest;
  });
}

const WRITER_RULES = `You write the final answer for a Thai business executive in a Telegram chat, on behalf of "Sift AI".
RULES
- Thai only, polite (end with ค่ะ/นะคะ), concise and scannable: short header line, then "- " bullets. Use *bold* sparingly. No tables, no JSON, no tool names.
- Use ONLY the facts provided. Copy numbers exactly; never calculate, estimate or invent any number, date, time or chat id.
- Always mention the period label of the data.
- If a fact set has zero results, say clearly that nothing was found for that period.
- If a period "is_partial" is true and periods are compared, point out that it is not complete yet and refer to the per-day average if given.
- Respect the executive's focus when given (e.g. answer only one item).
- Chat ids are written in backticks.
- Statements in the "other" category are not problems; never call them problems.
- If "unsupported" notes are given, include them verbatim at the end.`;

const ADVICE_RULES = `
FOR RESOLUTION ADVICE (get_resolution_advice facts):
1. "สิ่งที่เกิดขึ้น": the counts/trend/peak hours from facts, then 2-4 common symptom themes you read from customer_statements (themes only, WITHOUT counts).
2. If "sop" exists: steps taken from it under the heading "📘 จากคู่มือ (<sop.status>)", choosing and ordering the steps that fit the observed symptoms. Do not change their meaning.
3. Optional extra ideas MUST be under the heading "💡 ข้อเสนอแนะเพิ่มเติมจาก AI (ยังไม่อยู่ในคู่มือ)".
4. Possible causes are written as "สิ่งที่ควรตรวจสอบ", never as confirmed facts.
5. Never advise refunding, adjusting balances or changing customer money yourself; advise escalating to the responsible team.
6. If no "sop", say "ยังไม่มีคู่มือสำหรับหมวดนี้" and give only the labeled AI suggestions.
7. Match the level of detail to the question: a broad question gets an overview with priorities; a question about a specific team (e.g. dev) gets that team's detailed steps.`;

/**
 * Compose the reply for a data answer.
 * @returns {Promise<{ reply: string, mode: 'llm'|'deterministic' }>}
 */
export async function composeAnswer({ query, focus, results, unsupportedTopics }) {
  const deterministic = formatDeterministic(results, unsupportedTopics);
  const facts = compactFacts(results);
  const needsAdvice = results.some(r => r.tool === 'get_resolution_advice' && !r.error);

  try {
    const { content } = await ollamaChat([
      { role: 'system', content: WRITER_RULES + (needsAdvice ? ADVICE_RULES : '') },
      {
        role: 'user',
        content: `QUESTION: ${query}\nFOCUS: ${focus || '-'}\nFACTS (JSON):\n${JSON.stringify(facts)}\n${unsupportedTopics.length ? `UNSUPPORTED NOTES (include verbatim):\n${unsupportedText(unsupportedTopics)}\n` : ''}\nWrite the answer.`
      }
    ], { temperature: 0.2, maxTokens: needsAdvice ? 1200 : 700, timeoutMs: 120000 });

    const reply = stripForeignScripts(content);
    if (!reply) return { reply: deterministic, mode: 'deterministic' };
    if (!numbersAreGrounded(reply, facts, query + ' ' + unsupportedText(unsupportedTopics))) {
      console.warn('⚠️ [Composer] LLM reply contains numbers not present in the facts; using deterministic format.');
      return { reply: deterministic, mode: 'deterministic' };
    }
    return { reply, mode: 'llm' };
  } catch (err) {
    console.warn('⚠️ [Composer] LLM composition failed, using deterministic format:', err.message);
    return { reply: deterministic, mode: 'deterministic' };
  }
}

/**
 * Small talk / out-of-scope reply (no data, no numbers).
 * @param {string} query
 * @param {any[]} [history] - Recent turns, so replies like "อ๋อ เข้าใจละ" fit the conversation
 */
export async function composeChitchat(query, history = []) {
  const fallback = `สวัสดีค่ะ Sift AI ช่วยตอบเรื่อง${CAPABILITIES}ได้ค่ะ ลองถามได้เลยนะคะ เช่น "สรุปปัญหาเดือนนี้" หรือ "เคสด่วนสัปดาห์นี้มีอะไรบ้าง"`;
  const lastTurn = history[history.length - 1];
  const context = lastTurn ? `Previous question: ${lastTurn.user_query}\nPrevious answer (excerpt): ${(lastTurn.reply || '').replace(/\s+/g, ' ').slice(0, 200)}` : 'No previous turn.';
  try {
    const { content } = await ollamaChat([
      {
        role: 'system',
        content: `You are "Sift AI", a friendly, polite Thai assistant for business executives about customer-chat analytics. Reply in Thai only (ค่ะ/นะคะ), 1-3 short sentences, warm and a little playful when the user is casual.
- Greetings / thanks / compliments ("ทำไมเก่งจัง"): respond naturally and modestly, then offer help.
- Small talk or anything outside the business ("วันนี้กินอะไรดี", weather): play along lightly in one sentence, say you don't have data on that, and suggest a business question you CAN answer (${CAPABILITIES}).
- The user is unhappy with a previous answer ("ตอบมั่ว", "ผิด"): apologize briefly without arguing, and ask which part was wrong or invite them to ask again with the period/category.
- Never invent statistics, numbers or business facts in this reply. Do not start every reply with "สวัสดี".`
      },
      { role: 'user', content: `${context}\n\nMessage: ${query}` }
    ], { temperature: 0.6, maxTokens: 200, timeoutMs: 60000 });
    const reply = stripForeignScripts(content);
    return reply && numbersIn(reply).every(n => parseInt(n, 10) <= 24) ? reply : fallback;
  } catch {
    return fallback;
  }
}
