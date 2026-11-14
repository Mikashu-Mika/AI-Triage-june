/**
 * Turns tool facts into the Telegram reply.
 * The LLM writes the wording, but every number in its reply must exist in the facts; otherwise the
 * deterministic formatter below is used, so the bot never presents invented figures.
 */
import { ollamaChat, stripForeignScripts } from './llm.js';
import { todayContext } from './timeframe.js';

const UNSUPPORTED_REPLIES = {
  money_amounts: 'ระบบยังไม่มีข้อมูลยอดเงิน/ยอดฝาก-ถอน/ธุรกรรมทางการเงิน จึงตอบส่วนนี้ไม่ได้ค่ะ',
  slips: 'ระบบยังไม่มีข้อมูลสลิปโอนเงิน จึงตอบส่วนนี้ไม่ได้ค่ะ',
  campaigns: 'ระบบยังไม่มีข้อมูลแคมเปญหรือช่องทางการตลาด จึงตอบส่วนนี้ไม่ได้ค่ะ',
  admin_response_time: 'ระบบยังไม่มีข้อมูลเวลาที่แอดมินตอบแชต (SLA) จึงตอบส่วนนี้ไม่ได้ค่ะ',
  personal_data: 'ขออภัยค่ะ ไม่สามารถเปิดเผยข้อมูลติดต่อส่วนตัวของลูกค้า (เบอร์โทร/อีเมล/รหัสผ่าน) ตามนโยบายความปลอดภัยค่ะ',
  customer_tier: 'ระบบยังไม่มีข้อมูลระดับสมาชิกของลูกค้า (เช่น ใครเป็น VIP) จึงนับลูกค้า VIP ไม่ได้ค่ะ',
  holidays: 'ระบบยังไม่มีข้อมูลปฏิทินวันหยุด/เทศกาล จึงเทียบช่วงเทศกาลกับวันปกติไม่ได้ค่ะ ถ้าระบุวันที่มา ช่วยดูให้ได้นะคะ',
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

function formatIssueStats(f, query = '') {
  if (f.not_found) {
    const unk = f.filters?.unknown_categories?.join(', ') || 'ที่ระบุ';
    const lines = [`📊 ไม่พบหมวด "${unk}" ในระบบค่ะ`];
    if (f.available_categories?.length) {
      lines.push(`💡 หมวดหมู่ที่มีในระบบ: ${f.available_categories.slice(0, 8).join(', ')}`);
    }
    return lines.join('\n');
  }
  const unit = f.group_unit || GROUP_UNIT[f.group_by] || 'หมวด';
  const isRemainingQuery = f.remaining_only || /(ที่เหลือ|หมวดที่เหลือ|อีก \d+ (หมวด|ช่วงเวลา|ระดับ))/i.test(query);
  if (isRemainingQuery && f.remaining_groups_after_top5?.list) {
    const rest = f.remaining_groups_after_top5;
    const lines = [`📊 อีก ${rest.groups} ${unit}ที่เหลือ ${f.period.label}`, `- รวม ${rest.issues} ปัญหา`, ''];
    rest.list.forEach((g, i) => lines.push(`${i + 6}. ${g.group} — ${g.issues} ปัญหา (${g.pct_of_all_problems}%)`));
    if (f.group_by === 'category') lines.push('', '💡 พิมพ์ชื่อหมวดเพื่อดูรายการแชตได้ค่ะ');
    return lines.join('\n').trim();
  }
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
    f.groups.slice(0, 5).forEach((g, i) => lines.push(`${i + 1}. ${g.group} — ${g.issues} ปัญหา (${g.pct_of_all_problems}%)`));
    const rest = f.remaining_groups_after_top5;
    if (rest) lines.push(`- อีก ${rest.groups} ${unit}ที่เหลือ รวม ${rest.issues} ปัญหา`);
  }
  lines.push('');
  if (f.period.is_partial) lines.push('📌 ช่วงเวลานี้ยังไม่จบ ตัวเลขนับถึงปัจจุบันค่ะ');
  else if (f.group_by === 'category' && f.groups.length > 1) lines.push('💡 พิมพ์ชื่อหมวดเพื่อดูรายการแชตได้ค่ะ');
  return lines.join('\n').trim();
}

function formatChatList(f) {
  if (f.not_found) {
    const unk = f.filters?.unknown_categories?.join(', ') || 'ที่ระบุ';
    const lines = [`📋 ไม่พบหมวด "${unk}" ในระบบค่ะ`];
    if (f.available_categories?.length) {
      lines.push(`💡 หมวดหมู่ที่มีในระบบ: ${f.available_categories.slice(0, 8).join(', ')}`);
    }
    return lines.join('\n');
  }
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
  if (f.not_found) {
    const unk = f.filters?.unknown_categories?.join(', ') || 'ที่ระบุ';
    const lines = [`📊 ไม่พบหมวด "${unk}" ในระบบค่ะ`];
    if (f.available_categories?.length) {
      lines.push(`💡 หมวดหมู่ที่มีในระบบ: ${f.available_categories.slice(0, 8).join(', ')}`);
    }
    return lines.join('\n');
  }
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
    // A running month is shorter: the total can be lower while the daily rate is higher
    const totalWord = f.diff < 0 ? 'ยอดรวมยังน้อยกว่า' : f.diff > 0 ? 'ยอดรวมมากกว่า' : 'ยอดรวมเท่ากับ';
    const rateWord = f.period_a.per_day > f.period_b.per_day ? 'สูงกว่า' : f.period_a.per_day < f.period_b.per_day ? 'ต่ำกว่า' : 'เท่ากับ';
    lines.push('', `📌 ${f.period_a.label} ยังไม่จบ (${f.period_a.days} วัน): ${totalWord}${f.period_b.label} แต่ค่าเฉลี่ยต่อวัน${rateWord} (${f.period_a.per_day} กับ ${f.period_b.per_day}/วัน) ค่ะ`);
  }
  return lines.join('\n');
}

function formatCustomers(f, query = '') {
  const allTime = f.period.label.includes('ทั้งหมด');
  const lines = [`👥 ข้อมูลลูกค้า ${f.period.label}`];
  if (f.metric === 'total') {
    lines.push(allTime
      ? `- ลูกค้าทั้งหมดในระบบ: ${f.total_customers_now} คน`
      : `- ลูกค้าทั้งหมด ณ สิ้นช่วงนี้: ${f.total_customers_at_period_end} คน`);
    if (!allTime) lines.push(`- สมัครใหม่ในช่วงนี้: ${f.new_customers_in_period} คน`);
  } else {
    lines.push(`- ลูกค้าใหม่: ${f.new_customers_in_period} คน`, `- ลูกค้าทั้งหมดในระบบตอนนี้: ${f.total_customers_now} คน`);
  }
  if (f.top_customers_by_problems?.length && /(มากที่สุด|เยอะที่สุด|มากสุด|เยอะสุด|อันดับ)/.test(query)) {
    lines.push('', '🏆 ลูกค้าที่มีปัญหามากที่สุด');
    f.top_customers_by_problems.forEach((c, i) => lines.push(`${i + 1}. ${c.name} (\`${c.customer_id}\`) ${c.problems} ปัญหา จาก ${c.chats} แชต · แชต ${c.chat_ids.map(id => `\`${id}\``).join(', ')}`));
  }
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
  if (f.key_moods && f.total_chats) {
    lines.push(`- โกรธ ${f.key_moods['โกรธ']} แชต · ไม่พอใจ ${f.key_moods['ไม่พอใจ']} แชต · พอใจ ${f.key_moods['พอใจ']} แชต`);
  }
  const examples = (title, list) => {
    if (!list?.length) return;
    lines.push('', title);
    list.forEach((e, i) => lines.push(`${i + 1}. \`${e.chat_id}\` (${e.time}, ${e.sentiment})`, `   ${clip(e.summary, 140)}`));
  };
  if (f.praise_examples?.length) examples(`💖 แชตที่ลูกค้าชม/ขอบคุณ (${f.praise_chats} แชต)`, f.praise_examples);
  else if (f.total_chats) lines.push('', `💖 ยังไม่พบแชตที่ลูกค้าชมหรือขอบคุณการบริการโดยตรงค่ะ${f.positive_label_note ? ` (${f.positive_label_note})` : ''}`);
  examples('📌 ตัวอย่างแชตเชิงลบ', f.negative_examples);
  return lines.join('\n');
}

function formatCategoryInfo(f) {
  if (f.not_found || !f.category) {
    const unk = f.unknown_category || f.unknown_categories?.join(', ') || 'ที่ถาม';
    const known = (f.available_categories || f.known_categories || []).map(c => c.name || c);
    return `📖 ไม่พบหมวด "${unk}" ในระบบค่ะ\n💡 หมวดหมู่ที่มีในระบบ: ${known.slice(0, 8).join(', ')}`;
  }
  const lines = [`📖 หมวด${f.category.name}`];
  if (f.category.description) lines.push(`- ครอบคลุม: ${f.category.description}`);
  if (f.sop) lines.push('', `📘 คู่มือ (${f.sop.status})`, f.sop.content);
  else lines.push('', 'ℹ️ ยังไม่มีคู่มือแก้ปัญหาสำหรับหมวดนี้ค่ะ');
  return lines.join('\n');
}

function formatAdvice(f) {
  if (f.not_found || !f.category) {
    const unk = f.unknown_category || f.unknown_categories?.join(', ') || 'ที่ถาม';
    const known = (f.available_categories || f.known_categories || []).map(c => c.name || c);
    return `🛠️ ไม่พบหมวด "${unk}" ในระบบค่ะ\n💡 หมวดหมู่ที่มีในระบบ: ${known.slice(0, 8).join(', ')}`;
  }
  if (f.no_problems_found) return `🛠️ แนวทางแก้ปัญหา ${f.period.label}\n- ไม่พบปัญหาในช่วงนี้ จึงยังไม่มีเรื่องที่ต้องแก้ค่ะ`;
  const lines = [`🛠️ แนวทางแก้ "${f.category.name}" ${f.period.label}`, '', '📌 สิ่งที่เกิดขึ้น'];
  lines.push(`- ${f.issues_in_period} ปัญหา จาก ${f.chats_in_period} แชต (${f.previous_period.label}: ${f.previous_period.issues} ปัญหา)`);
  if (f.peak_hours.length) lines.push(`- พบมากช่วง ${f.peak_hours.map(h => h.hour).join(', ')}`);
  if (f.example_chats.length) lines.push(`- แชตตัวอย่าง: ${f.example_chats.map(id => `\`${id}\``).join(', ')}`);
  if (f.sop) lines.push('', `📘 จากคู่มือ (${f.sop.status})`, f.sop.content.replace(/\*\*/g, ''));
  else lines.push('', 'ℹ️ ยังไม่มีคู่มือแก้ปัญหาสำหรับหมวดนี้ค่ะ');
  return lines.join('\n');
}

function formatEmerging(f) {
  const lines = [`📈 ปัญหาที่กำลังเพิ่มขึ้น ${f.period.label}`, `- เทียบกับ${f.baseline.label}`];
  if (f.no_emerging) {
    lines.push('', `✅ ยังไม่พบหมวดที่เพิ่มขึ้นผิดปกติ (เกิน ${f.rules.min_increase_pct}% และอย่างน้อย ${f.rules.min_chats} แชต) ค่ะ`);
  } else {
    lines.push('');
    f.emerging.forEach((e, i) => {
      const change = e.is_new ? 'หมวดใหม่ ไม่มีในช่วงก่อนหน้า' : `${signed(e.pct_change)}%`;
      lines.push(`${i + 1}. ${e.category} — ${e.current_chats} แชต (เฉลี่ยเดิม ${e.baseline_avg}, ${change})`);
      e.examples.forEach(x => lines.push(`   • \`${x.chat_id}\` (${x.time}, ความด่วน${x.priority}) ${clip(x.summary, 100)}`));
    });
    if (f.more_emerging) lines.push('', `- อีก ${f.more_emerging.categories} หมวดที่เพิ่มขึ้นเกินเกณฑ์: ${f.more_emerging.names.join(', ')}`);
  }
  if (f.watch_list?.length) {
    lines.push('', '👀 เพิ่มขึ้นแต่ยังไม่ถึงเกณฑ์');
    f.watch_list.forEach(w => lines.push(`- ${w.category}: ${w.baseline_avg} → ${w.current_chats} แชต`));
  }
  if (f.period.is_partial && !f.period.label.startsWith('ย้อนหลัง')) lines.push('', '📌 ช่วงนี้ยังไม่จบ ระบบเทียบกับช่วงเวลาที่ยาวเท่ากันของช่วงก่อนหน้าค่ะ');
  return lines.join('\n').trim();
}

const FORMATTERS = {
  get_issue_stats: formatIssueStats,
  list_chats: formatChatList,
  search_chats: formatChatList,
  compare_periods: formatCompare,
  get_customer_stats: formatCustomers,
  get_sentiment: formatSentiment,
  get_category_info: formatCategoryInfo,
  get_resolution_advice: formatAdvice,
  detect_emerging_issues: formatEmerging
};

export function formatDeterministic(results, unsupportedTopics = [], query = '') {
  const parts = results.map(r => r.error ? `⚠️ ดึงข้อมูลส่วนนี้ไม่สำเร็จ: ${r.error}` : (FORMATTERS[r.tool]?.(r, query) || ''));
  if (unsupportedTopics.length) parts.push(unsupportedText(unsupportedTopics));
  return parts.filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// LLM composition with number grounding check
// ---------------------------------------------------------------------------
const numbersIn = text => (String(text).match(/\d+(?:[.,]\d+)*/g) || []).map(n => n.replace(/,/g, ''));

function buildGroundingMaps(facts) {
  const categoryMap = new Map();
  const periodMap = new Map();

  function addNumberToMap(map, key, num) {
    if (!key || num === undefined || num === null) return;
    const cleanKey = String(key).trim();
    if (!cleanKey) return;
    if (!map.has(cleanKey)) map.set(cleanKey, new Set());
    const s = String(num);
    map.get(cleanKey).add(s);
    if (s.includes('.')) {
      map.get(cleanKey).add(String(parseFloat(s)));
      map.get(cleanKey).add(String(Math.round(parseFloat(s))));
    } else {
      map.get(cleanKey).add(`${s}.0`);
    }
  }

  const list = Array.isArray(facts) ? facts : [facts];
  for (const r of list) {
    if (!r) continue;
    // 1. Category groups
    if (Array.isArray(r.groups)) {
      for (const g of r.groups) {
        if (g.group) {
          addNumberToMap(categoryMap, g.group, g.issues);
          addNumberToMap(categoryMap, g.group, g.chats);
          addNumberToMap(categoryMap, g.group, g.pct_of_all_problems);
        }
      }
    }
    // 2. remaining_groups_after_top5?.list
    if (Array.isArray(r.remaining_groups_after_top5?.list)) {
      for (const g of r.remaining_groups_after_top5.list) {
        if (g.group) {
          addNumberToMap(categoryMap, g.group, g.issues);
          addNumberToMap(categoryMap, g.group, g.pct_of_all_problems);
        }
      }
    }
    // 3. biggest_category_changes
    if (Array.isArray(r.biggest_category_changes)) {
      for (const c of r.biggest_category_changes) {
        if (c.category) {
          addNumberToMap(categoryMap, c.category, c.current);
          addNumberToMap(categoryMap, c.category, c.previous);
          addNumberToMap(categoryMap, c.category, c.diff);
          addNumberToMap(categoryMap, c.category, Math.abs(c.diff));
        }
      }
    }
    // 4. categories list
    if (Array.isArray(r.categories)) {
      for (const c of r.categories) {
        const name = c.category || c.name || c.group;
        if (name) {
          addNumberToMap(categoryMap, name, c.count || c.issues || c.value);
        }
      }
    }

    // 4b. Emerging issues (current chats, baseline average, change) and their example chat ids
    for (const e of [...(r.emerging || []), ...(r.watch_list || [])]) {
      if (!e.category) continue;
      for (const n of [e.current_chats, e.baseline_avg, e.diff, Math.abs(e.diff ?? 0), e.pct_change, Math.abs(e.pct_change ?? 0)]) addNumberToMap(categoryMap, e.category, n);
      for (const x of e.examples || []) numbersIn(x.chat_id).forEach(n => addNumberToMap(categoryMap, e.category, n));
    }
    // "อีก N หมวด: a, b, c" line names the remaining rising categories next to their count
    for (const name of r.more_emerging?.names || []) addNumberToMap(categoryMap, name, r.more_emerging.categories);

    // 5. Periods (period_a & period_b in compare_periods)
    if (r.period_a?.label) {
      addNumberToMap(periodMap, r.period_a.label, r.period_a.value);
      addNumberToMap(periodMap, r.period_a.label, r.period_a.per_day);
    }
    if (r.period_b?.label) {
      addNumberToMap(periodMap, r.period_b.label, r.period_b.value);
      addNumberToMap(periodMap, r.period_b.label, r.period_b.per_day);
    }
  }

  return { categoryMap, periodMap };
}

/**
 * Every number in the reply must appear in the facts or the question
 * (small integers are allowed for list numbering).
 * Also strictly validates that numbers on category/period lines match the respective ground truth facts.
 */
export function numbersAreGrounded(reply, facts, query) {
  const allowed = new Set([...numbersIn(JSON.stringify(facts)), ...numbersIn(query)]);
  // Allow "45.0" vs "45", and the same number without decimals
  for (const n of [...allowed]) {
    if (n.includes('.')) allowed.add(String(parseFloat(n)));
  }
  // List numbering ("1. ", "2) ") is not data; every other number, small ones included, must come from the facts
  const withoutListMarkers = String(reply).replace(/^\s*\d{1,2}[.)]\s/gm, '');
  const globalOk = numbersIn(withoutListMarkers).every(n => allowed.has(n) || allowed.has(String(parseFloat(n))));
  if (!globalOk) return false;

  // 2. Line-by-line Category and Period Grounding Check
  const { categoryMap, periodMap } = buildGroundingMaps(facts);
  const knownCategories = [...categoryMap.keys()].sort((a, b) => b.length - a.length);
  const knownPeriods = [...periodMap.keys()].sort((a, b) => b.length - a.length);
  const queryNumbers = new Set(numbersIn(query));
  
  // Year / standard calendar number filter
  const isPeriodNumber = n => {
    const val = parseInt(n, 10);
    return (val >= 2560 && val <= 2580) || (val >= 2020 && val <= 2040);
  };

  const lines = String(reply).split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // Strip list numbering (e.g. "1. ", "2) ") and clock times (e.g. "14:00-14:59 น.", "10:30 น.")
    const cleanLine = line
      .replace(/^\s*\d{1,2}[.)]\s/, '')
      .replace(/\b\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\s*(?:น\.)?/g, '');
    const lineNums = numbersIn(cleanLine);
    if (lineNums.length === 0) continue;

    // A. Check Category Grounding on this line
    const matchedCats = knownCategories.filter(cat => cleanLine.includes(cat));
    if (matchedCats.length > 0) {
      for (const num of lineNums) {
        const parsedNum = num.includes('.') ? String(parseFloat(num)) : num;
        const belongsToCat = matchedCats.some(cat => {
          const catNums = categoryMap.get(cat);
          return catNums.has(num) || catNums.has(parsedNum);
        });

        if (!belongsToCat) {
          if (queryNumbers.has(num) || queryNumbers.has(parsedNum) || isPeriodNumber(num)) {
            continue;
          }
          console.warn(`⚠️ [Composer Grounding] Category mismatch on line: "${line}" (number: ${num})`);
          return false;
        }
      }
    }

    // B. Check Period Grounding on this line
    const matchedPeriods = knownPeriods.filter(p => cleanLine.includes(p));
    if (matchedPeriods.length > 0) {
      for (const num of lineNums) {
        const parsedNum = num.includes('.') ? String(parseFloat(num)) : num;
        const belongsToPeriod = matchedPeriods.some(p => {
          const pNums = periodMap.get(p);
          return pNums.has(num) || pNums.has(parsedNum);
        });

        if (!belongsToPeriod) {
          if (queryNumbers.has(num) || queryNumbers.has(parsedNum) || isPeriodNumber(num)) {
            continue;
          }
          console.warn(`⚠️ [Composer Grounding] Period mismatch on line: "${line}" (number: ${num})`);
          return false;
        }
      }
    }
  }

  return true;
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
- Line 1: one emoji + short title + EXACT period.label from facts (e.g. if period.label is "วันนี้ (10 พ.ย. 2569)" write "📊 สรุปปัญหาวันนี้ (10 พ.ย. 2569)"; if period.label is "เมื่อวาน (9 พ.ย. 2569)" write "📊 สรุปปัญหาเมื่อวาน (9 พ.ย. 2569)"). You MUST strictly use the exact period.label from the JSON facts. NEVER write "เมื่อวาน" when the data is for "วันนี้"!
- Line 2: the overall total first (e.g. "- รวม 48 ปัญหา จาก 10 แชต").
- Ranked groups: MUST strictly take items in the exact order of the "groups" array starting from the FIRST item (index 0). NEVER skip, reorder, or filter out any item from "groups" (every item in "groups" is an official problem category, including "ข้อเสนอแนะและร้องเรียน"). If the user asks for top N (e.g. 3 อันดับแรก), you MUST output ALL requested N items as a numbered list (1., 2., 3...) and NEVER output only 1 item!
  Format for each item: "1. ชื่อหมวด — N ปัญหา (x%)"
  If no N is specified, show at most the top 5. Add a line about the rest ONLY when "remaining_groups_after_top5" is not null, using exactly its numbers and its "unit" (e.g. "- อีก 9 หมวดที่เหลือ รวม 14 ปัญหา", or "- อีก 3 ช่วงเวลาที่เหลือ รวม 70 ปัญหา" when grouped by hour).
  Percentages are "pct_of_all_problems": the share of ALL problems in the period. Write the category names exactly as in the facts, character for character.
- Total line: the issue count is the value of matched_problem_issues and the chat count is the value of matched_chats (write the numbers, never the field names). Never use any other chat count there.
- Title by topic: problems "📊 สรุปปัญหา…", customers "👥 ข้อมูลลูกค้า…", mood "😊 อารมณ์ลูกค้า…", chat lists "📋 …", comparisons "📅 เปรียบเทียบ…". Never call customer or mood data "สรุปปัญหา".
- If the question asks WHY something changed, answer it: name the categories that changed most (from biggest_category_changes) as the main reasons, and if a period is_partial, say whether the per-day average went up or down. Do not claim causes the facts do not show.
- If remaining_only is true, list ONLY the groups after the top 5 (from rank 6), never the top 5 again.
- Comparisons (compare_periods): show both periods with their value and per_day, then diff and pct_change. "biggest_category_changes" are CHANGES, written "ชื่อหมวด: previous → current"; never present them as a ranking and never add percentages to them.
- Emerging issues (detect_emerging_issues): title "📈 ปัญหาที่กำลังเพิ่มขึ้น" + period.label, then one line with baseline.label. For each item of "emerging" in order: "1. ชื่อหมวด — current_chats แชต (เฉลี่ยเดิม baseline_avg, +pct_change%)" (write "หมวดใหม่" instead of the percentage when is_new is true), then its examples indented: "\`chat_id\` (time) summary". When "more_emerging" is not null, add one line: "- อีก <categories> หมวดที่เพิ่มขึ้นเกินเกณฑ์: <names joined by comma>" (never add a chat total for them). If "no_emerging" is true, say clearly that no category rose above the rules (more than rules.min_increase_pct% and at least rules.min_chats chats) and you may mention "watch_list" as "baseline_avg → current_chats". These counts are CHATS, not issues.
- Chat lists: numbered, one chat per item: "\`chat_id\` (เวลา, ความด่วน<priority>)" then the customer's problem summarized on the next line indented by 3 spaces; list higher-priority chats first.
- Do not repeat the same phrase on every line (e.g. "จากการสนทนา X ครั้ง"). Never output an empty bullet, a lone "-" or a line containing only "ค่ะ".
- You may end with ONE short line: an observation grounded in the facts (📌) or a follow-up suggestion (💡). The last sentence ends with ค่ะ/นะคะ.
- Always mention the period label of the data. Strictly use the exact period.label given in the facts; never mismatch "วันนี้" and "เมื่อวาน".
- If a fact set has zero results, say clearly that nothing was found for that period.
- If the facts show "not_found: true" or report unknown_categories, you MUST clearly state that the requested category was not found in the system (e.g. "ไม่พบหมวด \"...\" ในระบบค่ะ"). DO NOT report totals or problems from all categories!
- If a period "is_partial" is true and periods are compared, point out that it is not complete yet and refer to the per-day average if given.
- Respect the executive's focus when given. But if the question asks for top N (e.g. 3 อันดับแรก), ALWAYS list all N items.
- If the question asks about remaining groups (e.g. "หมวดที่เหลือมีอะไรบ้าง", "อีก 13 หมวดมีอะไร"): You MUST list all items from "remaining_groups_after_top5.list" (or items from rank 6 onwards in "groups") with their issue counts and percentages (e.g. "6. ชื่อหมวด — N ปัญหา (x%)", "7. ..."). NEVER say "ไม่พบข้อมูล"!
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
// Answers that are lists or simple counts read best in the fixed format: the LLM only adds risk there
// (renamed categories, stray markdown, "สรุปปัญหา" titles on customer data).
const DETERMINISTIC_TOOLS = new Set(['get_customer_stats', 'get_sentiment', 'list_chats', 'search_chats', 'get_category_info', 'compare_periods']);
const WHY_PATTERN = /(ทำไม|เพราะอะไร|สาเหตุ|อธิบาย|วิเคราะห์|ควรแก้|แก้ยังไง|แก้ไขอย่างไร)/;

/** The LLM reply must keep the facts' wording: no foreign leftovers and no invented category names */
export function wordingIsClean(reply, facts) {
  // Markdown leftovers and JSON field names are not part of a Thai answer
  const text = reply.replace(/`[^`\n]*`/g, '');
  if (/```|\*\*|ชื่อหมวด\s*:|[a-z]+_[a-z_]+/i.test(text)) return false;
  // English words the facts never contain are leftovers ("สรุปปัญหายesterday"); words from the data (API, SMS) are fine
  const factText = JSON.stringify(facts).toLowerCase();
  const strayWord = (text.match(/[a-z]{4,}/gi) || []).find(w => !factText.includes(w.toLowerCase()));
  if (strayWord) {
    console.warn(`⚠️ [Composer] Stray English word in reply: "${strayWord}"`);
    return false;
  }
  // The total line must use the matched counts, not the period's overall total
  for (const m of text.matchAll(/รวม\s*(\d+)\s*ปัญหา\s*จาก\s*(\d+)\s*แชต/g)) {
    const ok = facts.some(r => (String(r.matched_problem_issues) === m[1] && String(r.matched_chats) === m[2]) ||
      (String(r.issues_in_period) === m[1] && String(r.chats_in_period) === m[2]));
    if (!ok) {
      console.warn(`⚠️ [Composer] Total line does not match the facts: "${m[0]}"`);
      return false;
    }
  }
  const known = new Set();
  for (const r of facts) {
    for (const g of [...(r.groups || []), ...(r.remaining_groups_after_top5?.list || [])]) known.add(g.group);
    for (const c of r.biggest_category_changes || []) known.add(c.category);
    for (const e of [...(r.emerging || []), ...(r.watch_list || [])]) known.add(e.category);
    if (r.category?.name) known.add(r.category.name);
  }
  // Every ranked line "N. <name> — ..." must name a group exactly as the facts spell it
  for (const m of String(reply).matchAll(/^\s*\d{1,2}\.\s+([^—\n]+?)\s+—/gm)) {
    if (!known.has(m[1].trim())) {
      console.warn(`⚠️ [Composer] Unknown group name in reply: "${m[1].trim()}"`);
      return false;
    }
  }
  return true;
}

export async function composeAnswer({ query, focus, results, unsupportedTopics }) {
  const deterministic = formatDeterministic(results, unsupportedTopics, query);
  const facts = compactFacts(results);
  const needsAdvice = results.some(r => r.tool === 'get_resolution_advice' && !r.error);
  const isWhy = WHY_PATTERN.test(query);
  if (!isWhy && (results.every(r => r.error || DETERMINISTIC_TOOLS.has(r.tool)) || results.some(r => r.remaining_only))) {
    return { reply: deterministic, mode: 'deterministic' };
  }

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
    if (!wordingIsClean(reply, facts)) {
      console.warn('⚠️ [Composer] LLM reply changed names or left markup; using deterministic format.');
      return { reply: deterministic, mode: 'deterministic' };
    }
    // Safeguard: Ensure Line 1 period matches facts period (prevent LLM few-shot hallucination of 'เมื่อวาน' vs 'วันนี้')
    let finalReply = reply;
    const primaryPeriodLabel = results[0]?.period?.label || results[0]?.period_a?.label;
    if (primaryPeriodLabel && typeof finalReply === 'string') {
      const firstLine = finalReply.split('\n')[0] || '';
      if (primaryPeriodLabel.includes('วันนี้') && firstLine.includes('เมื่อวาน')) {
        finalReply = finalReply.replace(/^(.*)เมื่อวาน(.*)$/m, (m, p1, p2) => `${p1}วันนี้${p2}`);
      } else if (primaryPeriodLabel.includes('เมื่อวาน') && firstLine.includes('วันนี้')) {
        finalReply = finalReply.replace(/^(.*)วันนี้(.*)$/m, (m, p1, p2) => `${p1}เมื่อวาน${p2}`);
      }
    }
    return { reply: finalReply, mode: 'llm' };
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
  // The date is a fact, not small talk: never let the LLM re-spell it (it once wrote พ.ย. as พฤษภาคม)
  if (/(วันนี้วันอะไร|วันนี้วันที่|วันนี้วันที่เท่าไหร่|วันนี้คือวันอะไร)/.test(query)) {
    return `วันนี้คือ${todayContext().thai} ค่ะ 😊 อยากดูสรุปปัญหาของวันนี้หรือช่วงไหนบอกได้เลยนะคะ`;
  }
  const lastTurn = history[history.length - 1];
  const context = lastTurn ? `Previous question: ${lastTurn.user_query}\nPrevious answer (excerpt): ${(lastTurn.reply || '').replace(/\s+/g, ' ').slice(0, 200)}` : 'No previous turn.';
  try {
    const { content } = await ollamaChat([
      {
        role: 'system',
        content: `You are "Sift AI", a friendly, polite Thai assistant for business executives about customer-chat analytics. Reply in Thai only (ค่ะ/นะคะ), 1-3 short sentences, warm and a little playful when the user is casual.
- Greetings / thanks / compliments ("ทำไมเก่งจัง"): respond naturally and modestly, then offer help.
- Small talk or anything outside the business ("วันนี้กินอะไรดี", weather): play along lightly in one sentence, say you don't have data on that, and suggest a business question you CAN answer (${CAPABILITIES}).
- The user is unhappy with a previous answer ("ตอบมั่ว", "ผิด", "ทำไมตอบผิด", "ทำไมเป็น 100%"): apologize briefly without arguing, say plainly what in the previous answer may have been unclear if you can see it, and invite them to ask again with the period/category.
- Thanks in any spelling ("แต้งกิ้ว", "ขอบคุณคับ", "thx"): accept warmly; never apologize for thanks.
- Test messages ("เทส", "test") or instructions that are not questions ("งั้นถามใหม่", "ต่อไปรอบคอบหน่อย", "..."): acknowledge in one short sentence and say you are ready for the question. Never apologize for a test.
- The user asks what a word or phrase in the previous answer means: explain it plainly from the previous answer. Common ones: "ช่วงเวลานี้ยังไม่จบ / ยังไม่สมบูรณ์" = the period is still running, so numbers count up to now; "ปัญหายอดมาก/วันที่มีปัญหามากที่สุด" = the day or time with the highest number of problems; "อีก N หมวดที่เหลือ" = categories after the top 5; a strange date range in an earlier answer = a system error in that answer, apologize.
- The current date is ${todayContext().thai}. Use it when asked "วันนี้วันอะไร".
- Never invent statistics, numbers or business facts in this reply. Do not start every reply with "สวัสดี".`
      },
      { role: 'user', content: `${context}\n\nMessage: ${query}` }
    ], { temperature: 0.6, maxTokens: 512 });
    const reply = tidyReply(stripForeignScripts(content));
    const dateNumbers = new Set(numbersIn(todayContext().thai));
    return reply && numbersIn(reply).every(n => parseInt(n, 10) <= 24 || dateNumbers.has(n)) ? reply : fallback;
  } catch {
    return fallback;
  }
}
