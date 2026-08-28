import dotenv from 'dotenv';
import { supabase } from '../src/supabase.js';

dotenv.config();

async function testCompanyInsert() {
  console.log('Testing company insert with service_role client...');
  const { data, error } = await supabase
    .from('companies')
    .insert({
      name: 'DEVD Test Company',
      domain: 'https://www.dev-d.net',
      client_id: 'client_devd_test',
      client_secret: 'secret_devd_test'
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Insert Error:', error.message);
  } else {
    console.log('✅ Insert Successful:', data);
    // Cleanup test row
    await supabase.from('companies').delete().eq('id', data.id);
    console.log('Cleaned up test row.');
  }
}

testCompanyInsert();
