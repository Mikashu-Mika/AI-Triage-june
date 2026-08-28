import dotenv from 'dotenv';
import { supabase } from '../src/supabase.js';

dotenv.config();

async function testDirect() {
  const { data: custData, error: custErr } = await supabase.from('customers').select('*');
  console.log('customers data:', custData, 'error:', custErr);

  const { data: chatData, error: chatErr } = await supabase.from('chats').select('*').limit(5);
  console.log('chats sample data count:', chatData ? chatData.length : 0, 'error:', chatErr);
}

testDirect();
