import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function testCategoryTriggerExecution() {
  console.log('Testing category insertion with trigger...');
  const testCompanyId = '00000000-0000-4000-8000-000000000099';
  
  // 1. Insert test company
  const { data: comp, error: compErr } = await anonClient
    .from('companies')
    .insert({
      id: testCompanyId,
      name: 'Trigger Test Company',
      domain: 'https://test-trigger.net',
      client_id: 'client_' + Date.now(),
      client_secret: 'secret_' + Date.now()
    })
    .select()
    .single();

  if (compErr) {
    console.error('❌ Company insert failed:', compErr.message);
    return;
  }
  console.log('✅ Created test company:', comp.id);

  // 2. Insert test category with raw ID 'deposit_withdrawal'
  const { data: cat, error: catErr } = await anonClient
    .from('categories')
    .insert({
      id: 'deposit_withdrawal',
      name: 'ฝาก-ถอน (Test)',
      description: 'ทดสอบหมวดหมู่',
      company_id: comp.id
    })
    .select()
    .single();

  if (catErr) {
    console.error('❌ Category insert failed:', catErr.message);
  } else {
    console.log('✅ Category insert SUCCESSFUL via Trigger! Generated ID:', cat.id);
  }

  // Cleanup
  await anonClient.from('categories').delete().eq('company_id', comp.id);
  await anonClient.from('companies').delete().eq('id', comp.id);
  console.log('Cleaned up test data.');
}

testCategoryTriggerExecution();
