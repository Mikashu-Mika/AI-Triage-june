/**
 * Read-only report of the chats a company has sent through POST /api/chats/ingest.
 * Use it while testing an integration (e.g. OneBoxx) to see what arrived and what the AI did with it.
 *
 *   node scripts/checkIngest.js --company <id | client_id | name> [--since 2h] [--stuck 10] [--json]
 *
 *   --company  company id, its client_id, or its exact name (required)
 *   --since    window to look at: 30m, 2h, 1d, or a date/time such as 2026-11-27T09:00+07:00 (default 24h)
 *   --stuck    minutes a chat may stay pending before it counts as stuck (default 10)
 *   --json     print the report as JSON instead of text
 *
 * Only reads from Supabase; never changes data. Never prints conversations or credentials.
 * A resend of the same chat id updates the row in place, and chats have no updated_at column,
 * so resends of one id cannot be counted here; "duplicates" means the same conversation under different ids.
 */
import { supabase } from '../src/supabase.js';

const HELP = 'Usage: node scripts/checkIngest.js --company <id | client_id | name> [--since 2h] [--stuck 10] [--json]';

function parseArgs(argv) {
  const args = { since: '24h', stuck: 10, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (['--company', '--since', '--stuck'].includes(a)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${a} needs a value`);
      args[a.slice(2)] = value;
    } else throw new Error(`Unknown option: ${a}`);
  }
  return args;
}

function parseSince(value, now) {
  const m = /^(\d+)\s*([mhd])$/i.exec(value);
  if (m) {
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2].toLowerCase()];
    return new Date(now - Number(m[1]) * unitMs);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Cannot read --since "${value}" (use 30m, 2h, 1d or a date)`);
  return date;
}

async function findCompany(key) {
  const fields = 'id, name, client_id, package_tier, package_status';
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
  for (const column of isUuid ? ['id', 'client_id'] : ['client_id', 'name']) {
    const { data, error } = await supabase.from('companies').select(fields).eq(column, key).limit(2);
    if (error) throw new Error(`Failed to read companies: ${error.message}`);
    if (data.length === 1) return data[0];
    if (data.length > 1) throw new Error(`More than one company has ${column} "${key}"; use the company id`);
  }
  throw new Error(`No company found for "${key}"`);
}

async function readAll(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const bangkok = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16);
const ageMinutes = (iso, now) => Math.floor((now - new Date(iso).getTime()) / 60_000);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.company) {
    console.log(HELP);
    process.exitCode = args.help ? 0 : 1;
    return;
  }
  const stuckMinutes = Number(args.stuck);
  if (!Number.isFinite(stuckMinutes) || stuckMinutes <= 0) throw new Error('--stuck must be a positive number of minutes');

  const now = Date.now();
  const since = parseSince(args.since, now);
  const company = await findCompany(args.company);

  const chats = await readAll(() => supabase
    .from('chats')
    .select('id, customer_id, conversation, status, category_id, priority, summary, created_at, is_test')
    .eq('company_id', company.id)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true }));

  // Chats sent before the window that are not finished: a resend with a new conversation puts them back to pending
  const olderOpen = await readAll(() => supabase
    .from('chats')
    .select('id, status, created_at')
    .eq('company_id', company.id)
    .lt('created_at', since.toISOString())
    .in('status', ['pending', 'failed', 'quota_exceeded']));

  const ids = chats.map(c => c.id);
  const issueCounts = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('chat_issues').select('chat_id').in('chat_id', ids.slice(i, i + 200));
    if (error) throw new Error(`Failed to read chat_issues: ${error.message}`);
    for (const row of data) issueCounts.set(row.chat_id, (issueCounts.get(row.chat_id) || 0) + 1);
  }

  const customers = await readAll(() => supabase
    .from('customers')
    .select('id, name')
    .eq('company_id', company.id)
    .gte('created_at', since.toISOString()));
  const autoCustomers = customers.filter(c => typeof c.name === 'string' && c.name.startsWith('Guest Customer ('));

  const byStatus = {};
  for (const c of chats) byStatus[c.status] = (byStatus[c.status] || 0) + 1;

  const all = [...chats, ...olderOpen];
  const pending = all.filter(c => c.status === 'pending');
  const stuck = pending.filter(c => ageMinutes(c.created_at, now) >= stuckMinutes);
  const waiting = pending.filter(c => ageMinutes(c.created_at, now) < stuckMinutes);
  const failed = all.filter(c => c.status === 'failed');
  const quota = all.filter(c => c.status === 'quota_exceeded');
  const emptyResult = chats.filter(c => c.status === 'completed' && (!c.category_id || !c.summary || !issueCounts.get(c.id)));

  const groups = new Map();
  for (const c of chats) {
    const key = typeof c.conversation === 'string' ? c.conversation.trim() : JSON.stringify(c.conversation);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c.id);
  }
  const duplicates = [...groups.values()].filter(g => g.length > 1);

  const pick = (list) => list.map(c => ({ id: c.id, status: c.status, created_at: c.created_at, age_minutes: ageMinutes(c.created_at, now) }));
  const report = {
    company: { id: company.id, name: company.name, package_tier: company.package_tier, package_status: company.package_status },
    window: { since: since.toISOString(), until: new Date(now).toISOString() },
    received: { chats: chats.length, by_status: byStatus, test_chats: chats.filter(c => c.is_test).length, distinct_customers: new Set(chats.map(c => c.customer_id)).size },
    customers_created_automatically: autoCustomers.length,
    duplicate_conversations: duplicates,
    pending_waiting: pick(waiting),
    pending_stuck: pick(stuck),
    failed: pick(failed),
    quota_exceeded: pick(quota),
    completed_without_result: emptyResult.map(c => ({ id: c.id, has_category: Boolean(c.category_id), has_summary: Boolean(c.summary), issues: issueCounts.get(c.id) || 0 })),
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report, stuckMinutes);
  }
  const problems = stuck.length + failed.length + quota.length + emptyResult.length + duplicates.length;
  process.exitCode = problems ? 2 : 0;
}

function printText(r, stuckMinutes) {
  const line = (label, list, fmt) => {
    console.log(`\n${label}: ${list.length}`);
    for (const item of list.slice(0, 50)) console.log(`  - ${fmt(item)}`);
    if (list.length > 50) console.log(`  ... and ${list.length - 50} more (use --json for all)`);
  };
  const chatLine = c => `${c.id}  (${bangkok(c.created_at)}, ${c.age_minutes} min ago)`;

  console.log(`Company: ${r.company.name} (${r.company.id}) package ${r.company.package_tier ?? '-'} / ${r.company.package_status ?? '-'}`);
  console.log(`Window:  ${bangkok(r.window.since)} -> ${bangkok(r.window.until)} (Bangkok time)`);
  console.log(`\nChats received: ${r.received.chats}  (customers: ${r.received.distinct_customers}, test chats: ${r.received.test_chats})`);
  for (const [status, n] of Object.entries(r.received.by_status)) console.log(`  ${status}: ${n}`);
  console.log(`Customers created automatically: ${r.customers_created_automatically}`);

  line('Same conversation under different ids', r.duplicate_conversations, g => g.join(', '));
  line(`Pending, still within ${stuckMinutes} min`, r.pending_waiting, chatLine);
  line(`Pending longer than ${stuckMinutes} min (stuck)`, r.pending_stuck, chatLine);
  line('Triage failed', r.failed, chatLine);
  line('Not analysed: quota exceeded', r.quota_exceeded, chatLine);
  line('Completed but result missing', r.completed_without_result,
    c => `${c.id}  (category ${c.has_category ? 'yes' : 'no'}, summary ${c.has_summary ? 'yes' : 'no'}, issues ${c.issues})`);

  const problems = r.pending_stuck.length + r.failed.length + r.quota_exceeded.length + r.completed_without_result.length + r.duplicate_conversations.length;
  console.log(problems ? `\nNeeds a look: ${problems} item(s) above.` : '\nAll good: nothing stuck, failed or duplicated.');
}

main().catch(err => {
  console.error(`checkIngest: ${err.message}`);
  console.error(HELP);
  process.exitCode = 1;
});
