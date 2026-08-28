import { supabase } from '../src/supabase.js';

async function listAllCategories() {
  const { data: categories, error } = await supabase.from('categories').select('*');

  if (error) {
    console.error('Error fetching categories:', error);
    process.exit(1);
  }

  console.log(`==================================================`);
  console.log(`📊 TOTAL CATEGORIES IN SUPABASE: ${categories.length}`);
  console.log(`==================================================`);

  categories.forEach((cat, idx) => {
    console.log(`${idx + 1}. ID: ${cat.id}`);
    console.log(`   Name: ${cat.name}`);
    if (cat.name_th) console.log(`   Name TH: ${cat.name_th}`);
    if (cat.description) console.log(`   Description: ${cat.description}`);
    if (cat.company_id) console.log(`   Company ID: ${cat.company_id}`);
    console.log(`--------------------------------------------------`);
  });

  process.exit(0);
}

listAllCategories();
