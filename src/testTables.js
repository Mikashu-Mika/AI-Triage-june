import dotenv from 'dotenv';
import { supabase } from './supabase.js';

dotenv.config();

async function test() {
  const { data, error } = await supabase
    .from('chats')
    .select('id')
    .limit(1);

  console.log('Chats test:', error ? error.message : 'OK');

  // Let's try to query public schema information using pg_catalog if we have RPC or permission,
  // or simply query prove_trigger directly to see what error it returns.
  const { error: trigErr } = await supabase.from('prove_trigger').select('id').limit(1);
  console.log('prove_trigger test error:', trigErr ? trigErr.message : 'OK (No error, table exists)');
}

test();
