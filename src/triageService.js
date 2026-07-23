import { supabase, getPendingChats, updateTriageResult, getCategories, findSimilarChats, getTrainingExamples, saveChatIssues } from './supabase.js';
import { generateTriage, getEmbedding } from './ollama.js';

/**
 * Orchestrate the triage pipeline:
 * 1. Fetch available categories from Supabase.
 * 2. Fetch pending chats from Supabase.
 * 3. Process each chat through Qwen for triage parameters using dynamic categories.
 * 4. Process the summary through BGE-M3 for vector embedding.
 * 5. Query similar cases in the database via pgvector similarity search.
 * 6. Update the chat entry in Supabase (with category_id foreign key and all intelligence metrics).
 * 
 * @returns {Promise<{processedCount: number, successCount: number, failures: any[]}>}
 */
export async function runTriagePipeline(companyId) {
  console.log(`Starting AI Triage Pipeline for Company: ${companyId || 'Global'}...`);
  
  // 1. Fetch active categories & training examples
  let categories = [];
  let trainingExamples = [];
  try {
    categories = await getCategories(companyId);
    trainingExamples = await getTrainingExamples(companyId);
    console.log(`Loaded ${categories.length} categories and ${trainingExamples.length} training examples from Supabase.`);
  } catch (error) {
    console.error('Error fetching categories or training examples from Supabase:', error);
    throw error;
  }

  // 2. Fetch pending chats
  let pendingChats = [];
  try {
    pendingChats = await getPendingChats(companyId);
    console.log(`Found ${pendingChats.length} pending chats to process.`);
  } catch (error) {
    console.error('Error fetching pending chats from Supabase:', error);
    throw error;
  }

  const results = {
    processedCount: pendingChats.length,
    successCount: 0,
    failures: []
  };

  // 3. Process each chat
  for (const chat of pendingChats) {
    const customerName = chat.customers?.name || 'Unknown customer';
    console.log(`Processing chat ${chat.id} (Customer: ${customerName})...`);
    try {
      if (!chat.conversation) {
        throw new Error(`Chat conversation content is empty`);
      }

      // Step 3a: Run Triage Analysis (qwen2.5:14b) with dynamic categories list & few-shot examples
      console.log(`- Running Triage Analysis (Qwen 2.5)...`);
      const triage = await generateTriage(chat.conversation, categories, trainingExamples);
      console.log(`  Result: CategoryID="${triage.category_id}", Priority="${triage.priority}", Summary="${triage.summary}"`);

      // Step 3b: Generate Embeddings from Summary (bge-m3)
      console.log(`- Generating vector embedding (BGE-M3)...`);
      const embedding = await getEmbedding(triage.summary);
      console.log(`  Result: Vector generated successfully (length: ${embedding.length})`);

      // Step 3c: Search for similar cases in database using pgvector
      console.log(`- Searching for semantically similar cases...`);
      const similarChats = await findSimilarChats(embedding, 0.70, 5);
      
      let finalRecommendation = triage.ai_recommendation;
      if (similarChats.length > 0) {
        // Exclude the current chat itself if it matches (though it is pending so shouldn't have an embedding yet)
        const filteredMatches = similarChats.filter(match => match.id !== chat.id);
        if (filteredMatches.length > 0) {
          const closest = filteredMatches[0];
          console.log(`  Found ${filteredMatches.length} similar cases! Closest similarity: ${(closest.similarity * 100).toFixed(1)}%`);
          finalRecommendation = `[พบคดีที่คล้ายกัน ${(closest.similarity * 100).toFixed(1)}% ID: ${closest.id} - "${closest.summary}"]\n` + triage.ai_recommendation;
        } else {
          console.log(`  No similar cases found after filtering.`);
        }
      } else {
        console.log(`  No similar cases found.`);
      }
      
      finalRecommendation = formatMultiIssuesRecommendation(triage, finalRecommendation);

      // Step 3d: Update results to Supabase using category_id foreign key
      console.log(`- Saving results to Supabase...`);
      const normalizedCategory = normalizeCategoryId(triage.category_id, categories);
      await updateTriageResult(chat.id, {
        category_id: normalizedCategory,
        priority: triage.priority,
        summary: triage.summary,
        embedding,
        sub_category: triage.sub_category,
        intent: triage.intent,
        root_cause: triage.root_cause,
        sentiment: triage.sentiment,
        urgency: triage.urgency,
        department: triage.department,
        keywords: triage.keywords,
        confidence: triage.confidence,
        recommended_reply: triage.recommended_reply,
        resolution: triage.resolution,
        business_impact: triage.business_impact,
        business_impact_score: triage.business_impact_score,
        ai_recommendation: finalRecommendation
      });

      // Step 3e: Save multi-issue breakdown to chat_issues table
      console.log(`- Saving relational multi-issue breakdown to Supabase...`);
      const normalizedIssues = (triage.detected_issues || []).map(iss => ({
        ...iss,
        category_id: normalizeCategoryId(iss.category_id, categories)
      }));
      await saveChatIssues(chat.id, normalizedIssues);

      console.log(`Chat ${chat.id} processed successfully!`);
      results.successCount++;
    } catch (error) {
      console.error(`Failed to process chat ${chat.id}:`, error.message);
      results.failures.push({
        id: chat.id,
        customer_name: customerName,
        error: error.message
      });
    }
  }

  console.log(`AI Triage Pipeline finished. Processed: ${results.processedCount}, Success: ${results.successCount}, Failures: ${results.failures.length}`);
  return results;
}

/**
 * Process a single chat session through the triage pipeline.
 * @param {string} chatId - The ID of the chat.
 */
export async function processSingleChat(chatId) {
  console.log(`Processing single chat ${chatId} in real-time...`);
  try {
    // 1. Fetch the specific chat
    const { data: chat, error: fetchErr } = await supabase
      .from('chats')
      .select('*, customers(*)')
      .eq('id', chatId)
      .single();
      
    if (fetchErr || !chat) {
      throw new Error(`Chat ${chatId} not found in database: ${fetchErr?.message || ''}`);
    }
    
    if (!chat.conversation) {
      throw new Error(`Chat conversation content is empty`);
    }

    // 2. Fetch available categories & training examples for the chat's company
    const categories = await getCategories(chat.company_id);
    const trainingExamples = await getTrainingExamples(chat.company_id);

    // 3. Run Triage Analysis (Qwen 2.5) with training examples
    const triage = await generateTriage(chat.conversation, categories, trainingExamples);
    
    // 4. Generate Embeddings (BGE-M3)
    const embedding = await getEmbedding(triage.summary);
    
    // 5. Search for similar cases (pgvector)
    const similarChats = await findSimilarChats(embedding, 0.70, 5);
    let finalRecommendation = triage.ai_recommendation;
    if (similarChats.length > 0) {
      const filteredMatches = similarChats.filter(match => match.id !== chat.id);
      if (filteredMatches.length > 0) {
        const closest = filteredMatches[0];
        finalRecommendation = `[พบคดีที่คล้ายกัน ${(closest.similarity * 100).toFixed(1)}% ID: ${closest.id} - "${closest.summary}"]\n` + triage.ai_recommendation;
      }
    }
    finalRecommendation = formatMultiIssuesRecommendation(triage, finalRecommendation);

    // 6. Update results in Supabase
    const normalizedCategory = normalizeCategoryId(triage.category_id, categories);
    await updateTriageResult(chat.id, {
      category_id: normalizedCategory,
      priority: triage.priority,
      summary: triage.summary,
      embedding,
      sub_category: triage.sub_category,
      intent: triage.intent,
      root_cause: triage.root_cause,
      sentiment: triage.sentiment,
      urgency: triage.urgency,
      department: triage.department,
      keywords: triage.keywords,
      confidence: triage.confidence,
      recommended_reply: triage.recommended_reply,
      resolution: triage.resolution,
      business_impact: triage.business_impact,
      business_impact_score: triage.business_impact_score,
      ai_recommendation: finalRecommendation
    });

    // 7. Save multi-issue breakdown to chat_issues table
    console.log(`- Saving relational multi-issue breakdown to Supabase...`);
    const normalizedIssues = (triage.detected_issues || []).map(iss => ({
      ...iss,
      category_id: normalizeCategoryId(iss.category_id, categories)
    }));
    await saveChatIssues(chat.id, normalizedIssues);

    console.log(`Single chat ${chatId} processed successfully!`);
  } catch (err) {
    console.error(`Error in processSingleChat for ${chatId}:`, err);
    // Mark as failed in Supabase so queue doesn't hang
    await supabase.from('chats').update({ status: 'failed', summary: `Triage failed: ${err.message}` }).eq('id', chatId);
    throw err;
  }
}

/**
 * Helper to format multi-issue breakdowns from AI triage into a readable list.
 * @param {object} triage - The raw AI output object.
 * @param {string} baseRec - The existing AI recommendation / case similarity string.
 * @returns {string} - The formatted recommendation.
 */
function formatMultiIssuesRecommendation(triage, baseRec) {
  let recommendation = baseRec || '';
  
  if (triage.detected_issues && triage.detected_issues.length > 0) {
    let breakdown = `\n\n📌 [ประเด็นปัญหาทั้งหมดที่ตรวจพบในแชตนี้ (Multi-Issue Breakdown)]:\n`;
    triage.detected_issues.forEach(issue => {
      breakdown += `- **เรื่องที่ ${issue.issue_no || 1}:** ${issue.problem_summary || ''}\n`;
      breakdown += `  - หมวดหมู่: ${issue.category_id || 'อื่นๆ'}\n`;
      breakdown += `  - แผนก: ${issue.department || 'Support'} (ความเร่งด่วน: ${issue.urgency || 'low'})\n`;
      if (issue.recommended_reply) {
        breakdown += `  - แนะนำบทสนทนาตอบลูกค้า: "${issue.recommended_reply}"\n`;
      }
    });
    recommendation += breakdown;
  }
  
  return recommendation;
}

/**
 * Normalize category ID from LLM output by matching it against company's categories.
 * @param {string} id - Raw category ID from LLM.
 * @param {any[]} categories - List of active categories for the company.
 * @returns {string} - The correct resolved category ID.
 */
function normalizeCategoryId(id, categories) {
  if (!id || !categories || categories.length === 0) return null;
  // 1. Direct match
  if (categories.some(c => c.id === id)) return id;
  // 2. Suffix match (e.g. "deposit_withdrawal" matching "company_id:deposit_withdrawal")
  const suffix = id.split(':').pop();
  const suffixMatch = categories.find(c => c.id.endsWith(`:${suffix}`) || c.id.endsWith(`:${id}`) || c.id === suffix);
  if (suffixMatch) return suffixMatch.id;
  // 3. Name match (case-insensitive)
  const nameMatch = categories.find(c => c.name.toLowerCase() === id.toLowerCase());
  if (nameMatch) return nameMatch.id;
  // 4. Default to first category
  return categories[0].id;
}
