import { getCategoryDisplayName, findCategoryKeysByName } from '../src/categoryHelper.js';
import { getCategories } from '../src/supabase.js';

async function test() {
  const cats = await getCategories();
  console.log('Total categories fetched:', cats.length);
  
  console.log('\n--- Test 1: getCategoryDisplayName ---');
  console.log('Thai (page_load_freeze):', getCategoryDisplayName('page_load_freeze', cats, 'th'));
  console.log('English (page_load_freeze):', getCategoryDisplayName('page_load_freeze', cats, 'en'));
  console.log('Thai (deposit_withdrawal):', getCategoryDisplayName('deposit_withdrawal', cats, 'th'));
  console.log('English (deposit_withdrawal):', getCategoryDisplayName('deposit_withdrawal', cats, 'en'));
  
  console.log('\n--- Test 2: findCategoryKeysByName ---');
  console.log('Search "โหลดช้า":', findCategoryKeysByName('โหลดช้า', cats));
  console.log('Search "freeze":', findCategoryKeysByName('freeze', cats));
  console.log('Search "api error":', findCategoryKeysByName('api error', cats));
  console.log('Search "VIP Privileges":', findCategoryKeysByName('VIP Privileges', cats));
  console.log('Search "การเงิน":', findCategoryKeysByName('การเงิน', cats));
  
  console.log('\n--- Test 3: Sample API Output Shape ---');
  console.log(JSON.stringify(cats.slice(0, 2), null, 2));
}

test().catch(console.error);
