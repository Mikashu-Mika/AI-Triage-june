import dotenv from 'dotenv';
import { supabase } from '../src/supabase.js';

dotenv.config();

const tables = [
  'customers',
  'categories',
  'chats',
  'chat_issues',
  'companies',
  'users',
  'system_ip_whitelist',
  'prompt_configs',
  'knowledge_base',
  'training_examples',
  'prove_trigger',
  'prove_trigger_webhook_log',
  'audit_tasks',
  'audit_results',
  'like_results'
];

async function checkTables() {
  console.log('=== Checking Tables in New Supabase Project ===\n');
  
  for (const table of tables) {
    try {
      const { data, count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: false })
        .limit(5);

      if (error) {
        console.log(`❌ [${table}]: ERROR - ${error.message} (Code: ${error.code})`);
      } else {
        console.log(`✅ [${table}]: Table EXISTS | Total rows: ${count || 0} | Sample rows: ${data ? data.length : 0}`);
      }
    } catch (err) {
      console.log(`❌ [${table}]: Exception - ${err.message}`);
    }
  }
}

checkTables();
