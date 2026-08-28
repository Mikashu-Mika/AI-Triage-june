import { supabase } from '../src/supabase.js';

async function listCompanyCategories() {
  const companyId = '2c3f46cc-fae8-4ef8-99e1-874dec8b2af2';
  const { data: categories, error } = await supabase
    .from('categories')
    .select('*')
    .eq('company_id', companyId);

  if (error) {
    console.error('Error fetching company categories:', error);
    process.exit(1);
  }

  console.log(`==================================================`);
  console.log(`📊 TOTAL CATEGORIES FOR COMPANY (${companyId}): ${categories.length} หมวดหมู่`);
  console.log(`==================================================\n`);

  categories.forEach((c, idx) => {
    const rawKey = c.id.includes(':') ? c.id.split(':').pop() : c.id;
    console.log(`${idx + 1}. [${c.name}] (${rawKey})`);
    console.log(`   รายละเอียด: ${c.description || 'ไม่มีคำอธิบาย'}`);
  });

  process.exit(0);
}

listCompanyCategories();
