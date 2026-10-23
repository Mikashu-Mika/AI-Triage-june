import { supabase, getCategories } from '../src/supabase.js';
import { resolvePrimaryCategory } from '../src/triageService.js';

async function syncCategories() {
  console.log('🔄 Checking all chats for category consistency with chat_issues...');

  // Fetch all chats with their company_id and category_id
  const { data: chats, error: chatErr } = await supabase
    .from('chats')
    .select('id, category_id, company_id, summary');

  if (chatErr) {
    console.error('Failed to fetch chats:', chatErr);
    return;
  }

  // Fetch all chat_issues
  const { data: allIssues, error: issErr } = await supabase
    .from('chat_issues')
    .select('*')
    .order('created_at', { ascending: true });

  if (issErr) {
    console.error('Failed to fetch chat_issues:', issErr);
    return;
  }

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
        console.log(`Fixing chat ${chat.id}: current="${chat.category_id}" -> expected="${expectedCatId}" (Primary Issue: "${issues[0].summary}")`);
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

  console.log(`✅ Category synchronization complete. Updated ${updatedCount} chats.`);
}

syncCategories().catch(console.error);
