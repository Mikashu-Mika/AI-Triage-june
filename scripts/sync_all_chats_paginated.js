import { supabase, getCategories } from '../src/supabase.js';
import { resolvePrimaryCategory } from '../src/triageService.js';

async function fetchAllRows(tableName) {
  let allRows = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .range(from, from + batchSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return allRows;
}

async function main() {
  console.log('🔄 Fetching all chats and issues with pagination...');
  const chats = await fetchAllRows('chats');
  const allIssues = await fetchAllRows('chat_issues');

  console.log(`Fetched ${chats.length} chats and ${allIssues.length} issues.`);

  // Group issues by chat_id
  const issuesByChat = {};
  for (const iss of allIssues) {
    if (!issuesByChat[iss.chat_id]) issuesByChat[iss.chat_id] = [];
    issuesByChat[iss.chat_id].push(iss);
  }

  // Cache company categories
  const categoriesCache = {};
  async function getCompanyCats(comp) {
    if (!categoriesCache[comp]) {
      categoriesCache[comp] = await getCategories(comp);
    }
    return categoriesCache[comp];
  }

  let updatedCount = 0;

  for (const chat of chats) {
    const issues = issuesByChat[chat.id];
    if (issues && issues.length > 0) {
      const companyCats = await getCompanyCats(chat.company_id);
      const expectedCatId = resolvePrimaryCategory(chat.category_id, issues, companyCats);

      if (expectedCatId && chat.category_id !== expectedCatId) {
        console.log(`Updating chat [${chat.id}]: "${chat.category_id}" -> "${expectedCatId}" (Issue: "${issues[0].summary?.slice(0, 30)}")`);
        const { error: upErr } = await supabase
          .from('chats')
          .update({ category_id: expectedCatId })
          .eq('id', chat.id);

        if (upErr) {
          console.error(`Failed to update chat ${chat.id}:`, upErr.message);
        } else {
          updatedCount++;
        }
      }
    }
  }

  console.log(`\n🎉 Successfully synchronized all ${updatedCount} chats across the entire database!`);
}

main().catch(console.error);
