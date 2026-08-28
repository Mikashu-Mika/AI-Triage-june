import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// Create Supabase client using anon key
const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function testAnonInsert() {
  console.log('Testing company insert with ANON client key...');
  const { data, error } = await anonClient
    .from('companies')
    .insert({
      name: 'DEVD Test Company Anon',
      domain: 'https://www.dev-d-anon.net',
      client_id: 'client_anon_test',
      client_secret: 'secret_anon_test'
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Anon Insert Error:', error.message);
  } else {
    console.log('✅ Anon Insert Successful! Company ID:', data.id);
    // Clean up
    await anonClient.from('companies').delete().eq('id', data.id);
    console.log('Cleaned up test row successfully.');
  }
}

testAnonInsert();
