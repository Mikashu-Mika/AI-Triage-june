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
// Deterministic formatters (fallback + guaranteed-correct numbers).
// They follow the same clean layout the LLM is asked for: emoji + title + period, total first,
// top 5, the rest in one line, chat items with time/priority. No markdown bold.
// ---------------------------------------------------------------------------
const GROUP_UNIT = { category: 'หมวด', priority: 'ระดับ', day: 'วัน', hour: 'ช่วงเวลา' };
const GROUP_TITLE = { category: '📌 ปัญหาที่พบมากที่สุด', priority: '🚦 แยกตามความด่วน', day: '📅 วันที่พบมากที่สุด', hour: '⏰ ช่วงเวลาที่พบมากที่สุด' };
const METRIC_UNIT = { issues: 'ปัญหา', chats: 'แชต', new_customers: 'คน' };
const signed = n => (n > 0 ? `+${n}` : `${n}`);
const clip = (text, max) => (text && text.length > max ? `${text.slice(0, max)}…` : text || '-');

function formatIssueStats(f) {
  const cats = f.filters.categories;
  // Category names that already start with "ปัญหา" read naturally without "ปัญหาหมวด"
  const subject = cats.length === 1 && cats[0].startsWith('ปัญหา') ? cats[0] : `ปัญหาหมวด${cats.join(' / ')}`;
  const title = cats.length ? `สรุป${subject} ${f.period.label}` : `สรุปปัญหา${f.period.label}`;
  const lines = [`📊 ${title}`];
  if (f.matched_problem_issues === 0) {
    lines.push('- ไม่พบปัญหาตามเงื่อนไขในช่วงเวลานี้ค่ะ');
    return lines.join('\n');
  }
  lines.push(`- รวม ${f.matched_problem_issues} ปัญหา จาก ${f.matched_chats} แชต`);
  if (cats.length || f.filters.priorities.length) {
    lines.push(`- คิดเป็น ${f.pct_of_all_problems}% ของปัญหาทั้งหมด ${f.total_problem_issues_in_period} ปัญหา`);
  }
  const showList = f.groups.length > 1 || f.group_by !== 'category';
  if (showList) {
    lines.push('', GROUP_TITLE[f.group_by] || GROUP_TITLE.category);
    f.groups.slice(0, 5).forEach((g, i) => lines.push(`${i + 1}. ${g.group} — ${g.issues} ปัญหา (${g.pct_of_matched_issues}%)`));
    const rest = f.remaining_groups_after_top5;
    if (rest) lines.push(`- อีก ${rest.groups} ${GROUP_UNIT[f.group_by] || 'หมวด'}ที่เหลือ รวม ${rest.issues} ปัญหา`);
  }
  lines.push('');
  if (f.period.is_partial) lines.push('📌 ช่วงเวลานี้ยังไม่จบ ตัวเลขนับถึงปัจจุบันค่ะ');
  else if (f.group_by === 'category' && f.groups.length > 1) lines.push('💡 พิมพ์ชื่อหมวดเพื่อดูรายการแชตได้ค่ะ');
  return lines.join('\n').trim();
}

function formatChatList(f) {
  const isSearch = f.tool === 'search_chats';
  const total = isSearch ? f.total_matches : f.total_matched_chats;
  const cats = f.filters?.categories || [];
  const subject = isSearch ? `ผลค้นหา "${f.query}"` : cats.length ? `แชตหมวด${cats.join(' / ')}` : 'รายการแชต';
  const lines = [`📋 ${subject} ${f.period.label} — ${total} แชต`];
  if (!f.items?.length) {
    lines.push('- ไม่พบแชตตามเงื่อนไขค่ะ');
    return lines.join('\n');
  }
  lines.push('');
  f.items.forEach((it, i) => {
    const summary = it.issues?.[0]?.summary || it.chat_summary;
    lines.push(`${i + 1}. \`${it.chat_id}\` (${it.time}, ความด่วน${it.priority})`);
    lines.push(`   ${clip(summary, 160)}`);
    if (!cats.length && it.categories?.length) lines.push(`   หมวด: ${it.categories.join(', ')}`);
  });
  lines.push('');
  if (total > f.shown) {
    lines.push(f.excel_export
      ? `📎 แสดง ${f.shown} จาก ${total} แชต รายการทั้งหมดอยู่ในไฟล์ Excel ด้านล่างค่ะ`
      : `📌 แสดง ${f.shown} จาก ${total} แชตค่ะ`);
  }
  return lines.join('\n').trim();
}

function formatCompare(f) {
  const unit = METRIC_UNIT[f.metric] || '';
  const cats = f.filters?.categories?.length ? ` หมวด${f.filters.categories.join(' / ')}` : '';
  const lines = [`📅 เปรียบเทียบ${f.metric_th}${cats}`];
  lines.push(`- ${f.period_a.label}: ${f.period_a.value} ${unit} (เฉลี่ย ${f.period_a.per_day}/วัน)`);
  lines.push(`- ${f.period_b.label}: ${f.period_b.value} ${unit} (เฉลี่ย ${f.period_b.per_day}/วัน)`);
  lines.push(`- เปลี่ยนแปลง: ${signed(f.diff)} ${unit}${f.pct_change !== null ? ` (${signed(f.pct_change)}%)` : ''}`);
  if (f.biggest_category_changes?.length) {
    lines.push('', '📌 หมวดที่เปลี่ยนแปลงมากที่สุด');
    f.biggest_category_changes.forEach(c => lines.push(`- ${c.category}: ${c.previous} → ${c.current}`));
  }
  if (f.period_a.is_partial) {
    lines.push('', `📌 ${f.period_a.label} ยังไม่จบ (${f.period_a.days} วัน) ควรเทียบที่ค่าเฉลี่ยต่อวันค่ะ`);
  }
  return lines.join('\n');
}

function formatCustomers(f) {
  const lines = [`👥 ข้อมูลลูกค้า ${f.period.label}`, `- ลูกค้าใหม่: ${f.new_customers_in_period} คน`, `- ลูกค้าทั้งหมดในระบบ: ${f.total_customers} คน`];
  if (f.new_customers?.length) {
    lines.push('', '🆕 ลูกค้าที่สมัครใหม่');
    f.new_customers.forEach((c, i) => lines.push(`${i + 1}. ${c.name} (\`${c.customer_id}\`) สมัคร ${c.registered_at}`));
  }
  if (f.by_month?.length) {
    lines.push('', '📅 ลูกค้าใหม่รายเดือน');
    f.by_month.forEach(m => lines.push(`- ${m.month}: ${m.count} คน`));
  }
  if (f.pct_existing !== undefined) {
    lines.push('', `- แชตจากลูกค้าเก่า: ${f.chats_from_existing_customers} จาก ${f.chats_in_period} แชต (${f.pct_existing}%)`, `- ${f.definition}`);
  }
  if (f.repeat_customers) {
    lines.push('', `🔁 ลูกค้าที่ทักมากกว่า 1 ครั้ง: ${f.customers_with_multiple_chats} คน (แจ้งปัญหาหมวดเดิมซ้ำ ${f.customers_repeating_same_problem} คน)`);
    f.repeat_customers.slice(0, 10).forEach((r, i) => lines.push(`${i + 1}. ${r.name} (\`${r.customer_id}\`) ${r.chats} แชต${r.repeated_problems.length ? ` · ซ้ำเรื่อง ${r.repeated_problems.join(', ')}` : ''}`));
  }
  return lines.join('\n');
}

function formatSentiment(f) {
  const lines = [`😊 อารมณ์ลูกค้า ${f.period.label}`, `- จาก ${f.total_chats} แชต`];
  f.polarity.forEach(p => lines.push(`- เชิง${p.group}: ${p.count} แชต (${p.pct}%)`));
  const examples = (title, list) => {
    if (!list?.length) return;
    lines.push('', title);
    list.forEach((e, i) => lines.push(`${i + 1}. \`${e.chat_id}\` (${e.time}, ${e.sentiment})`, `   ${clip(e.summary, 140)}`));
  };
  examples('💖 แชตที่ลูกค้าชม/พอใจ', f.positive_examples);
  examples('📌 ตัวอย่างแชตเชิงลบ', f.negative_examples);
  return lines.join('\n');
}

function formatCategoryInfo(f) {
  if (!f.category) return `ไม่พบหมวดที่ถามค่ะ\n- หมวดที่มีในระบบ: ${(f.available_categories || []).map(c => c.name).join(', ')}`;
  const lines = [`📖 หมวด${f.category.name}`];
  if (f.category.description) lines.push(`- ครอบคลุม: ${f.category.description}`);
  if (f.sop) lines.push('', `📘 คู่มือ (${f.sop.status})`, f.sop.content);
  else lines.push('', 'ℹ️ ยังไม่มีคู่มือแก้ปัญหาสำหรับหมวดนี้ค่ะ');
  return lines.join('\n');
}

function formatAdvice(f) {
  if (f.no_problems_found) return `🛠️ แนวทางแก้ปัญหา ${f.period.label}\n- ไม่พบปัญหาในช่วงนี้ จึงยังไม่มีเรื่องที่ต้องแก้ค่ะ`;
  const lines = [`🛠️ แนวทางแก้ "${f.category.name}" ${f.period.label}`, '', '📌 สิ่งที่เกิดขึ้น'];
  lines.push(`- ${f.issues_in_period} ปัญหา จาก ${f.chats_in_period} แชต (${f.previous_period.label}: ${f.previous_period.issues} ปัญหา)`);
  if (f.peak_hours.length) lines.push(`- พบมากช่วง ${f.peak_hours.map(h => h.hour).join(', ')}`);
  if (f.example_chats.length) lines.push(`- แชตตัวอย่าง: ${f.example_chats.map(id => `\`${id}\``).join(', ')}`);
  if (f.sop) lines.push('', `📘 จากคู่มือ (${f.sop.status})`, f.sop.content.replace(/\*\*/g, ''));
  else lines.push('', 'ℹ️ ยังไม่มีคู่มือแก้ปัญหาสำหรับหมวดนี้ค่ะ');
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
  // List numbering ("1. ", "2) ") is not data; every other number, small ones included, must come from the facts
  const withoutListMarkers = String(reply).replace(/^\s*\d{1,2}[.)]\s/gm, '');
  return numbersIn(withoutListMarkers).every(n => allowed.has(n) || allowed.has(String(parseFloat(n))));
}

/** Drop fields the writer never uses (excel rows, internal notes, empty filters) */
export function compactFacts(results) {
  return results.map(r => {
    const { excel_export, note, ...rest } = r;
    const facts = { ...rest };
    if (excel_export) {
      facts.excel_file_attached = true;
      facts.excel_rows = excel_export.items.length;
    }
    if (facts.filters && !facts.filters.unknown_categories?.length) {
      const { unknown_categories, ...filters } = facts.filters;
      facts.filters = filters;
    }
    if (Array.isArray(facts.items)) {
      // The chat-level summary only adds something when the chat has no issue summaries
      facts.items = facts.items.map(({ chat_summary, issues, ...item }) => ({
        ...item,
        issues: issues || [],
        ...(issues?.length ? {} : { chat_summary })
      }));
    }
    return facts;
  });
}

/** Remove empty bullets and dangling polite particles the LLM sometimes leaves on their own line */
export function tidyReply(text) {
  const lines = (text || '').split('\n').map(l => l.replace(/\s+$/, ''));
  const out = [];
  for (const line of lines) {
    const bare = line.trim();
    if (/^[-•*]$/.test(bare)) continue;
    if (/^(ค่ะ|คะ|นะคะ|ครับ)[.!]?$/.test(bare) && out.length) {
      let i = out.length - 1;
      while (i >= 0 && !out[i].trim()) i--;
      if (i >= 0) {
        out[i] = `${out[i]} ${bare}`;
        out.length = i + 1;
        continue;
      }
    }
    if (!bare && out.length && !out[out.length - 1].trim()) continue; // collapse blank lines
    out.push(line);
  }
  return out.join('\n').trim();
}

const WRITER_RULES = `You write the final answer for a Thai business executive in a Telegram chat, on behalf of "Sift AI".
RULES
- Thai only, polite, concise and scannable. No tables, no JSON, no tool names, no markdown bold (**).
- Use ONLY the facts provided. Copy numbers exactly; never calculate, estimate or invent any number, date, time or chat id.
FORMAT
- Line 1: one emoji + short title + the period label (e.g. "📊 สรุปปัญหาเมื่อวาน (22 ต.ค. 2569)").
- Line 2: the overall total first (e.g. "- รวม 48 ปัญหา จาก 10 แชต").
- Ranked groups: show at most the top 5 as a numbered list "ชื่อ — N ปัญหา (x%)" using the group's own pct value. Add a line about the rest ONLY when "remaining_groups_after_top5" is not null, using exactly its numbers (e.g. "- อีก 9 หมวดที่เหลือ รวม 14 ปัญหา"). With a single group, show only that group.
- Comparisons (compare_periods): show both periods with their value and per_day, then diff and pct_change. "biggest_category_changes" are CHANGES, written "ชื่อหมวด: previous → current"; never present them as a ranking and never add percentages to them.
- Chat lists: numbered, one chat per item: "\`chat_id\` (เวลา, ความด่วน<priority>)" then the customer's problem summarized on the next line indented by 3 spaces; list higher-priority chats first.
- Do not repeat the same phrase on every line (e.g. "จากการสนทนา X ครั้ง"). Never output an empty bullet, a lone "-" or a line containing only "ค่ะ".
- You may end with ONE short line: an observation grounded in the facts (📌) or a follow-up suggestion (💡). The last sentence ends with ค่ะ/นะคะ.
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
    const { content, truncated } = await ollamaChat([
      { role: 'system', content: WRITER_RULES + (needsAdvice ? ADVICE_RULES : '') },
      {
        role: 'user',
        content: `QUESTION: ${query}\nFOCUS: ${focus || '-'}\nFACTS (JSON):\n${JSON.stringify(facts)}\n${unsupportedTopics.length ? `UNSUPPORTED NOTES (include verbatim):\n${unsupportedText(unsupportedTopics)}\n` : ''}\nWrite the answer.`
      }
    ], { temperature: 0.2, maxTokens: 2048 }); // safety cap only; answers are not shortened

    const reply = tidyReply(stripForeignScripts(content));
    if (!reply) return { reply: deterministic, mode: 'deterministic' };
    if (truncated) {
      console.warn('⚠️ [Composer] LLM reply hit the length limit (cut mid-answer); using deterministic format.');
      return { reply: deterministic, mode: 'deterministic' };
    }
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
    ], { temperature: 0.6, maxTokens: 512 });
    const reply = tidyReply(stripForeignScripts(content));
    return reply && numbersIn(reply).every(n => parseInt(n, 10) <= 24) ? reply : fallback;
  } catch {
    return fallback;
  }
}
