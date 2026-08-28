import dotenv from 'dotenv';
import { supabase } from '../src/supabase.js';

dotenv.config();

async function checkIntegrity() {
  console.log('=== Checking Data & Foreign Key Integrity ===\n');

  // 1. Check Row Counts
  const tables = ['customers', 'chats', 'users', 'companies', 'categories', 'chat_issues', 'activity_logs', 'audit_tasks', 'audit_results'];
  for (const t of tables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`❌ [${t}]: Error counting - ${error.message}`);
    } else {
      console.log(`📊 [${t}]: ${count} rows found`);
    }
  }

  console.log('\n--- 2. Checking Foreign Key References (Data Matching) ---');

  // A. Check chats -> customers reference
  const { data: chatsWithCust, error: err1 } = await supabase
    .from('chats')
    .select('id, customer_id, customers(id, name)')
    .not('customer_id', 'is', null);
  
  if (err1) {
    console.log(`❌ Error querying chats with customers relation: ${err1.message}`);
  } else {
    const orphanedCust = chatsWithCust.filter(c => !c.customers);
    console.log(`🔍 [chats -> customers]: ${chatsWithCust.length} chats have customer_id. Orphaned (missing customer): ${orphanedCust.length}`);
    if (orphanedCust.length > 0) {
      console.log('  ⚠️ Orphaned chat customer IDs:', orphanedCust.map(c => ({ chat: c.id, customer_id: c.customer_id })));
    }
  }

  // B. Check chats -> companies reference
  const { data: chatsWithComp, error: err2 } = await supabase
    .from('chats')
    .select('id, company_id, companies(id, name)')
    .not('company_id', 'is', null);

  if (err2) {
    console.log(`❌ Error querying chats with companies relation: ${err2.message}`);
  } else {
    const orphanedComp = chatsWithComp.filter(c => !c.companies);
    console.log(`🔍 [chats -> companies]: ${chatsWithComp.length} chats have company_id. Orphaned (missing company): ${orphanedComp.length}`);
    if (orphanedComp.length > 0) {
      console.log('  ⚠️ Orphaned chat company IDs:', orphanedComp.map(c => ({ chat: c.id, company_id: c.company_id })));
    }
  }

  // C. Check users -> companies reference
  const { data: usersWithComp, error: err3 } = await supabase
    .from('users')
    .select('id, company_id, email, companies(id, name)')
    .not('company_id', 'is', null);

  if (err3) {
    console.log(`❌ Error querying users with companies relation: ${err3.message}`);
  } else {
    const orphanedUserComp = usersWithComp.filter(u => !u.companies);
    console.log(`🔍 [users -> companies]: ${usersWithComp.length} users have company_id. Orphaned (missing company): ${orphanedUserComp.length}`);
    if (orphanedUserComp.length > 0) {
      console.log('  ⚠️ Orphaned user company IDs:', orphanedUserComp.map(u => ({ user: u.id, email: u.email, company_id: u.company_id })));
    }
  }

  // D. Check categories -> companies reference
  const { data: catWithComp, error: err4 } = await supabase
    .from('categories')
    .select('id, company_id, name, companies(id, name)')
    .not('company_id', 'is', null);

  if (err4) {
    console.log(`❌ Error querying categories with companies relation: ${err4.message}`);
  } else {
    const orphanedCatComp = catWithComp ? catWithComp.filter(c => !c.companies) : [];
    console.log(`🔍 [categories -> companies]: ${catWithComp ? catWithComp.length : 0} categories have company_id. Orphaned: ${orphanedCatComp.length}`);
  }

  // E. Check chat_issues -> chats reference
  const { data: issuesWithChat, error: err5 } = await supabase
    .from('chat_issues')
    .select('id, chat_id, chats(id)')
    .not('chat_id', 'is', null);

  if (err5) {
    console.log(`❌ Error querying chat_issues with chats relation: ${err5.message}`);
  } else {
    const orphanedIssues = issuesWithChat ? issuesWithChat.filter(i => !i.chats) : [];
    console.log(`🔍 [chat_issues -> chats]: ${issuesWithChat ? issuesWithChat.length : 0} issues have chat_id. Orphaned: ${orphanedIssues.length}`);
  }
}

checkIntegrity();
