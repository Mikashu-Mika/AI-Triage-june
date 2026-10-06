import { supabase } from '../src/supabase.js';
import { CATEGORY_BILINGUAL_MAP } from '../src/categoryConstants.js';
import { getEmbedding } from '../src/ollama.js';

export const UNIFIED_BILINGUAL_CATEGORIES = CATEGORY_BILINGUAL_MAP;

async function checkColumnExists() {
  const { error } = await supabase
    .from('categories')
    .select('name_en')
    .limit(1);
  return !error;
}

async function main() {
  const hasNameEn = await checkColumnExists();
  console.log(`Database support for 'name_en' column: ${hasNameEn ? 'YES ✅' : 'NO (not yet added in schema) ⚠️'}`);

  console.log(`🧠 Pre-computing BGE-M3 vector embeddings for category definitions...`);
  const categoryEmbeddings = {};
  for (const [key, target] of Object.entries(CATEGORY_BILINGUAL_MAP)) {
    const textToEmbed = `${target.name_th} ${target.name_en}: ${target.description}`;
    try {
      categoryEmbeddings[key] = await getEmbedding(textToEmbed);
      console.log(`  - Embedded [${key}]: ${categoryEmbeddings[key]?.length} dims`);
    } catch (e) {
      console.warn(`  ⚠️ Failed to generate embedding for [${key}]:`, e.message);
    }
  }

  const { data: existing, error } = await supabase.from('categories').select('*');
  if (error) {
    console.error('Fetch error:', error);
    return;
  }

  console.log(`Found ${existing.length} existing categories.`);
  let updatedCount = 0;

  for (const cat of existing) {
    const rawKey = cat.id.includes(':') ? cat.id.split(':')[1] : cat.id;
    const target = UNIFIED_BILINGUAL_CATEGORIES[rawKey];
    if (target) {
      const updatePayload = {
        name: target.name_th, // Pure Thai without parenthesis
        description: target.description
      };
      if (hasNameEn) {
        updatePayload.name_en = target.name_en; // Pure English
      }
      if (categoryEmbeddings[rawKey]) {
        updatePayload.embedding = categoryEmbeddings[rawKey];
      }

      const { error: upErr } = await supabase
        .from('categories')
        .update(updatePayload)
        .eq('id', cat.id);

      if (upErr) {
        console.error(`Failed to update ${cat.id}:`, upErr.message);
      } else {
        updatedCount++;
      }
    } else {
      console.warn(`No target mapping for rawKey: ${rawKey} (${cat.id})`);
    }
  }

  console.log(`✅ Successfully updated ${updatedCount} categories with pure Thai names and BGE-M3 embeddings.`);
  if (!hasNameEn) {
    console.log(`
ℹ️ NOTE FOR MIKA:
To persist 'name_en' permanently in the Supabase database table, please run this 1 line in Supabase SQL Editor:
ALTER TABLE categories ADD COLUMN IF NOT EXISTS name_en TEXT;

Once executed, rerun: node scripts/populate_bilingual_categories.js
Our backend API already supports bilingual output dynamically in the meantime!
`);
  } else {
    console.log(`✅ Both 'name' (Thai) and 'name_en' (English) were persisted to Supabase!`);
  }
}

main().catch(console.error);
