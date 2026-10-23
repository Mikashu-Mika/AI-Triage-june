import dotenv from 'dotenv';
import http from 'http';
dotenv.config();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

/**
 * Attempt to repair and parse potentially malformed JSON from LLM output.
 * Handles common issues: markdown fences, trailing commas, unescaped quotes, truncated JSON.
 * @param {string} raw - Raw string from LLM.
 * @returns {object} - Parsed JSON object.
 */
function repairAndParseJSON(raw) {
  let text = raw;

  // 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  text = text.trim();

  // 2. Extract only the JSON object if there's extra text before/after
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.substring(firstBrace, lastBrace + 1);
  }

  // 3. Try parsing as-is first
  try {
    return JSON.parse(text);
  } catch (e) {
    // Continue with repairs
  }

  // 4. Fix trailing commas before } or ]
  text = text.replace(/,\s*([}\]])/g, '$1');

  // 5. Fix unescaped newlines inside string values
  text = text.replace(/(?<=:\s*"[^"]*)\n([^"]*")/g, '\\n$1');

  // 6. Try to close truncated JSON (count braces/brackets)
  let braceCount = 0, bracketCount = 0;
  for (const ch of text) {
    if (ch === '{') braceCount++;
    else if (ch === '}') braceCount--;
    else if (ch === '[') bracketCount++;
    else if (ch === ']') bracketCount--;
  }
  while (bracketCount > 0) { text += ']'; bracketCount--; }
  while (braceCount > 0) { text += '}'; braceCount--; }

  // 7. Try parsing again after repairs
  try {
    return JSON.parse(text);
  } catch (e2) {
    // 8. Last resort: remove problematic characters and try once more
    text = text.replace(/[\x00-\x1F\x7F]/g, ' '); // control characters
    try {
      return JSON.parse(text);
    } catch (e3) {
      console.error('❌ JSON repair failed. Raw content:', raw.substring(0, 500));
      throw new Error(`Failed to parse Ollama JSON response: ${e3.message}`);
    }
  }
}

/**
 * Custom POST request implementation using Node's native http module.
 * This bypasses the 30-second header timeout limitation of Node's built-in fetch.
 */
function postRequest(urlStr, data, timeoutMs = 900000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const postData = JSON.stringify(data);
    
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          statusText: res.statusMessage,
          json: async () => JSON.parse(responseBody)
        });
      });
    });
    
    // Disable socket inactivity timeout so LLM generation is never interrupted
    req.setTimeout(0);
    
    req.on('error', (err) => {
      reject(err);
    });
    
    req.write(postData);
    req.end();
  });
}
const MODEL_LLM = process.env.MODEL_LLM || 'qwen2.5:14b';
const MODEL_EMBEDDING = process.env.MODEL_EMBEDDING || 'bge-m3';
const OLLAMA_NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || '8192', 10);

/**
 * Generate Triage classification using local Qwen model.
 * @param {string} conversation - Chat conversation content.
 * @param {Array<{id: string, name: string, description: string}>} availableCategories - Dynamic categories list.
 * @returns {Promise<{category_id: string, priority: string, summary: string}>}
 */
export async function generateTriage(conversation, availableCategories = [], trainingExamples = [], segmentedClauses = []) {
  // Build dynamic categories text for LLM prompt
  const categoriesPromptList = availableCategories.map(
    c => `- "${c.id}": ${c.name} ${c.description ? `(${c.description})` : ''}`
  ).join('\n');

  let examplesPrompt = '';
  if (trainingExamples && trainingExamples.length > 0) {
    examplesPrompt = `\nVERIFIED EXAMPLES (human-approved classifications of similar chats):
${trainingExamples.map(ex => `Chat: "${ex.input_text}"
Output: ${ex.expected_output}`).join('\n\n')}\n`;
  }

  const clausesBlock = Array.isArray(segmentedClauses) && segmentedClauses.length > 0
    ? `\nPRE-SEGMENTED CLAUSES:\n${segmentedClauses.map((cl, idx) => `${idx + 1}. "${cl}"`).join('\n')}\n`
    : '';

  // Category definitions come 100% from the database (name + description), so the rules below stay domain-neutral
  const systemPrompt = `You are Sift AI, a customer-chat classification engine.
Analyze the customer chat and respond with ONE raw JSON object only (no markdown, no explanation).

LANGUAGE: every text value (summary, sub_category, root_cause, recommended_reply, ai_recommendation, problem_summary) MUST be Thai only.

AVAILABLE CATEGORIES (use the exact id; decide by each category's name and description):
${categoriesPromptList || '- "other": เรื่องอื่นๆ (สอบถามทั่วไป/ไม่ใช่ปัญหาของระบบ)'}
${examplesPrompt}
RULES
1. Split the chat into atomic customer statements (use PRE-SEGMENTED CLAUSES when given). Every statement must appear in exactly one "detected_issues" item.
2. One issue item = one category. If a sentence joins symptoms of different categories (e.g. with "และ", "แต่", "ทั้งที่", "แถม"), split it into separate items. Statements of the same category may be merged into one item.
3. Never create an item from a bare noun phrase without a problem predicate (e.g. "การส่งอีเมลยืนยัน"); keep it with the statement it belongs to.
4. Questions, greetings, context and inquiries that do NOT report a failure (e.g. asking how long something takes, asking about promotions or rules, "กำลังจะซื้อ...") are NOT problems: use the "other" category with urgency "low".
5. Complaints about service quality, dissatisfaction and improvement suggestions belong to the category whose description covers complaints/feedback; requests for new features to the feature-request category when one exists.
6. Unauthorized account changes, suspected hacking, or requests to change bank account / phone / credentials are high-risk: urgency "high" or "urgent".
7. Top-level "category_id", "priority" and "urgency" describe the most severe real problem; if the chat has no real problem use "other" with priority "low".
8. "problem_summary" is the customer's own statement (verbatim or lightly trimmed), not a paraphrase of the whole chat.

OUTPUT KEYS
category_id, sub_category (Thai), intent (refund|withdraw|deposit|register|verify|promotion|report_issue|complain|inquire|follow_up), root_cause (Thai, a plausible cause to check), sentiment (โกรธ|ไม่พอใจ|สับสน|สงสัย|ชมเชย|ปกติ), urgency, priority (low|medium|high|urgent), department (Finance|Support|Developer|Marketing|Admin|Head Admin|VIP), summary (1 Thai sentence), keywords (2-4 Thai words), confidence (0-100), recommended_reply (1 polite Thai sentence), resolution (Solved|Pending|Escalated|Rejected|Duplicate), business_impact (Revenue Risk|Customer Risk|None), business_impact_score (0-100), ai_recommendation (Thai, actionable for support), detected_issues: [{ issue_no, problem_summary, category_id, urgency, department }].
`;

  // Dynamically extract all valid category IDs from Supabase for this company to build strict enum
  const validCategoryIds = Array.from(new Set([
    ...availableCategories.map(c => c.id).filter(Boolean),
    ...availableCategories.map(c => (c.id || '').split(':').pop().trim()).filter(Boolean),
    'other'
  ]));

  const dynamicJsonSchema = {
    type: 'object',
    properties: {
      category_id: {
        type: 'string',
        enum: validCategoryIds
      },
      sub_category: { type: 'string' },
      intent: {
        type: 'string',
        enum: ['refund', 'withdraw', 'deposit', 'register', 'verify', 'promotion', 'report_issue', 'complain', 'inquire', 'follow_up']
      },
      root_cause: { type: 'string' },
      sentiment: {
        type: 'string',
        enum: ['โกรธ', 'ไม่พอใจ', 'สับสน', 'สงสัย', 'ชมเชย', 'ปกติ']
      },
      urgency: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'urgent']
      },
      priority: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'urgent']
      },
      department: {
        type: 'string',
        enum: ['Finance', 'Support', 'Developer', 'Marketing', 'Admin', 'Head Admin', 'VIP']
      },
      summary: { type: 'string' },
      keywords: {
        type: 'array',
        items: { type: 'string' }
      },
      confidence: { type: 'number' },
      recommended_reply: { type: 'string' },
      resolution: {
        type: 'string',
        enum: ['Solved', 'Pending', 'Escalated', 'Rejected', 'Duplicate']
      },
      business_impact: {
        type: 'string',
        enum: ['Revenue Risk', 'Customer Risk', 'None']
      },
      business_impact_score: { type: 'number' },
      ai_recommendation: { type: 'string' },
      detected_issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            issue_no: { type: 'integer' },
            problem_summary: { type: 'string' },
            category_id: {
              type: 'string',
              enum: validCategoryIds
            },
            urgency: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent']
            },
            department: {
              type: 'string',
              enum: ['Finance', 'Support', 'Developer', 'Marketing', 'Admin', 'Head Admin', 'VIP']
            }
          },
          required: ['problem_summary', 'category_id', 'urgency', 'department']
        }
      }
    },
    required: [
      'category_id',
      'summary',
      'detected_issues'
    ]
  };

  try {
    const response = await postRequest(`${OLLAMA_URL}/api/chat`, {
      model: MODEL_LLM,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this conversation:\n${conversation}${clausesBlock}` }
      ],
      stream: false,
      keep_alive: process.env.OLLAMA_KEEP_ALIVE || '60m',
      format: dynamicJsonSchema,
      options: {
        num_ctx: OLLAMA_NUM_CTX,
        temperature: 0.1
      }
    }, 900000);

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.message?.content?.trim();

    // Ollama silently truncates the prompt when it exceeds num_ctx: surface it so it can be tuned
    const promptTokens = data.prompt_eval_count ?? null;
    const outputTokens = data.eval_count ?? null;
    const contextOverflow = promptTokens !== null && outputTokens !== null && promptTokens + outputTokens >= OLLAMA_NUM_CTX - 16;
    if (contextOverflow) {
      console.warn(`⚠️ [Ollama] Context window nearly/fully used (${promptTokens} prompt + ${outputTokens} output >= num_ctx ${OLLAMA_NUM_CTX}). Increase OLLAMA_NUM_CTX.`);
    }
    
    const result = repairAndParseJSON(content);
    
    // Dynamically match category_id against availableCategories (supporting direct ID, clean key suffix, and name match)
    let category_id = result.category_id;
    const cleanKey = (category_id || '').split(':').pop().trim().toLowerCase();
    
    const matchedCategory = availableCategories.find(c => {
      const cCleanKey = (c.id || '').split(':').pop().trim().toLowerCase();
      const cName = (c.name || '').toLowerCase();
      return (
        c.id === category_id ||
        cCleanKey === cleanKey ||
        cName === (category_id || '').toLowerCase() ||
        cName.includes(cleanKey)
      );
    });

    if (matchedCategory) {
      category_id = matchedCategory.id;
    } else {
      // Dynamic fallback to the company's 'other' category, never blind first category
      const otherCategory = availableCategories.find(c => {
        const cCleanKey = (c.id || '').split(':').pop().trim().toLowerCase();
        return cCleanKey === 'other';
      });
      category_id = otherCategory ? otherCategory.id : 'other';
    }

    // Post-processing: Strip Chinese/CJK characters from all text fields
    // Qwen is a Chinese-trained model and sometimes outputs Chinese text
    const sanitizeChinese = (text) => {
      if (typeof text !== 'string') return text;
      // Remove CJK Unified Ideographs, CJK punctuation, and common Chinese punctuation
      return text
        .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u2e80-\u2eff\u3000-\u303f\uff01-\uff60\u3002\uff0c\uff1a\uff1b\uff1f\uff01\u201c\u201d\u2018\u2019\u300a\u300b\u3010\u3011\u2014\u2026\uff08\uff09]/g, '')
        .replace(/\s{2,}/g, ' ')  // collapse multiple spaces
        .trim();
    };

    // Apply sanitization to detected_issues as well
    const sanitizedIssues = (result.detected_issues || []).map(issue => ({
      ...issue,
      summary: issue.summary ? sanitizeChinese(issue.summary) : issue.summary,
      problem_summary: issue.problem_summary ? sanitizeChinese(issue.problem_summary) : issue.problem_summary,
      recommended_reply: issue.recommended_reply ? sanitizeChinese(issue.recommended_reply) : issue.recommended_reply,
      root_cause: issue.root_cause ? sanitizeChinese(issue.root_cause) : issue.root_cause,
      ai_recommendation: issue.ai_recommendation ? sanitizeChinese(issue.ai_recommendation) : issue.ai_recommendation,
    }));

    // Smart summary: if main summary is empty after sanitization, build from detected issues
    let mainSummary = sanitizeChinese(result.summary || '');
    if (!mainSummary || mainSummary.length < 3) {
      // Build summary from detected issues
      const issueSummaries = sanitizedIssues
        .map(iss => sanitizeChinese(iss.problem_summary || iss.summary || ''))
        .filter(s => s && s.length > 1);
      mainSummary = issueSummaries.length > 0
        ? issueSummaries.join(', ')
        : 'ไม่สามารถสรุปบทสนทนาได้';
    }

    return {
      category_id,
      priority: result.priority || 'medium',
      summary: mainSummary,
      sub_category: sanitizeChinese(result.sub_category || 'ทั่วไป'),
      intent: result.intent || 'inquire',
      root_cause: sanitizeChinese(result.root_cause || 'ไม่ทราบสาเหตุแน่ชัด'),
      sentiment: sanitizeChinese(result.sentiment || 'ปกติ'),
      urgency: result.urgency || 'medium',
      department: result.department || 'Support',
      keywords: result.keywords || [],
      confidence: typeof result.confidence === 'number' ? result.confidence : 80.0,
      recommended_reply: sanitizeChinese(result.recommended_reply || 'สวัสดีค่ะ ทีมงานกำลังอยู่ระหว่างตรวจสอบความผิดพลาดของระบบ รบกวนรอสักครู่ค่ะ'),
      resolution: result.resolution || 'Pending',
      business_impact: result.business_impact || 'None',
      business_impact_score: typeof result.business_impact_score === 'number' ? result.business_impact_score : 0.0,
      ai_recommendation: sanitizeChinese(result.ai_recommendation || 'แนะนำตรวจสอบปัญหาระบบทั่วไป'),
      detected_issues: sanitizedIssues,
      _meta: {
        model: MODEL_LLM,
        num_ctx: OLLAMA_NUM_CTX,
        prompt_tokens: promptTokens,
        output_tokens: outputTokens,
        context_overflow: contextOverflow
      }
    };
  } catch (error) {
    console.error('Error generating triage from Ollama:', error);
    throw error;
  }
}

/**
 * Generate vector embedding using local BGE-M3 model.
 * @param {string} text - The input text to embed.
 * @returns {Promise<number[]>} - 1024 dimension vector.
 */
export async function getEmbedding(text) {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_EMBEDDING,
        prompt: text
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama Embeddings API error: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.embedding) {
      throw new Error('Ollama response did not contain "embedding" field');
    }

    return data.embedding;
  } catch (error) {
    console.warn('Warning: Embedding generation skipped/failed:', error.message);
    return null;
  }
}
