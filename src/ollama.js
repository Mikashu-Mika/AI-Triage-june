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

/**
 * Generate Triage classification using local Qwen model.
 * @param {string} conversation - Chat conversation content.
 * @param {Array<{id: string, name: string, description: string}>} availableCategories - Dynamic categories list.
 * @returns {Promise<{category_id: string, priority: string, summary: string}>}
 */
export async function generateTriage(conversation, availableCategories = [], trainingExamples = []) {
  // Build dynamic categories text for LLM prompt
  const categoriesPromptList = availableCategories.map(
    c => `- "${c.id}": ${c.name} ${c.description ? `(${c.description})` : ''}`
  ).join('\n');

  let examplesPrompt = '';
  if (trainingExamples && trainingExamples.length > 0) {
    examplesPrompt = `\nFEW-SHOT TRAINING EXAMPLES (LEARN FROM THESE CORRECT CLASSIFICATIONS):
${trainingExamples.map(ex => `Customer message: "${ex.input_text}"
Expected Output JSON:
${ex.expected_output}`).join('\n\n')}\n`;
  }

  const systemPrompt = `You are an AI Customer Intelligence & Triage Platform.
Analyze the customer chat conversation and respond with a strictly formatted JSON object.
Do NOT include any markdown code blocks, explanation, or extra characters. Only output the raw JSON object.

CRITICAL LANGUAGE RULE: ALL text output in the JSON (summary, recommended_reply, root_cause, ai_recommendation, sub_category, problem_summary) MUST be in Thai language ONLY. Do NOT use Chinese, English, or any other language in the output text values.

${examplesPrompt}
CRITICAL DIRECTIVE ON CATEGORIES (100% DYNAMIC LOADING):
You must classify customer statements strictly based on the AVAILABLE CATEGORIES provided below. Compare the customer's issues against the Name and Description of each category:
${categoriesPromptList || '- "other": เรื่องอื่นๆ (สอบถามทั่วไป/ไม่ใช่ปัญหาของระบบ)'}

CORE PRINCIPLE 1: ATOMIC MULTI-ISSUE EXTRACTION (STRICT CATEGORY SEPARATION)
- Break down the customer conversation into distinct statements/clauses.
- EVERY distinct issue or topic reported in the chat MUST be extracted as its own separate object in the "detected_issues" array.
- STRICT CATEGORY PURITY: 1 issue object in "detected_issues" can ONLY contain statements that belong to the EXACT SAME category_id.
- NEVER combine sentences belonging to DIFFERENT categories into the same issue object!
- Do NOT join sentences across different categories with " / ".
- Sentences may ONLY be joined with " / " if they describe the exact same symptom and map to the exact same category_id.
- Example: If a customer reports page loading slow, image missing, button unresponsive, and cart freezing:
  - "หน้าเว็บโหลดช้า" -> Category matching loading delay (e.g., page_load_freeze) (Issue 1)
  - "รูปสินค้าไม่ขึ้น" -> Category matching graphics/UI (e.g., ui_rendering_issue) (Issue 2)
  - "ปุ่มไม่ตอบสนอง" -> Category matching button/interaction lag (e.g., interaction_lag) (Issue 3)
  - "พอเพิ่มลงตะกร้าหน้าจอก็ค้าง" -> Category matching freeze/hang (e.g., page_load_freeze) (Issue 4)
  You MUST output SEPARATE issue objects for different categories! NEVER bundle them into a single string under one category!

CORE PRINCIPLE 2: QUESTIONS & INQUIRIES ARE NOT PROBLEMS (คำถาม/ข้อสงสัย ไม่ใช่ปัญหา)
- A customer asking questions about how things work, duration, rules, or system status is an INQUIRY, NOT A SYSTEM INCIDENT!
- Look for question / inquiry signals:
  * Asking about duration or time: "กี่นาที", "กี่โมง", "ใช้เวลานานไหม", "นานไหม" (e.g. "ถอนใช้เวลากี่นาที" is a question asking about banking duration, NOT a deposit/withdrawal failure!)
  * Asking about availability or status: "เปิดไหม", "เปิดอยู่ไหม", "ปิดปรับปรุงไหม", "ได้ไหม" (e.g. "เว็ปเปิดไหม" is an inquiry, NOT a website outage!)
  * Asking about conditions, rewards, or terms: "ได้อะไร", "ทำเทิร์นด้วยหรอ", "ทำยังไง", "เท่าไหร่", "หรอ", "ไหม" (e.g. "สมัครใหม่ได้อะไร", "โบนัสทำเทิร์นด้วยหรอ" are inquiries about terms, NOT promotion bugs!)
  * Asking for information or benefits: "มีโปรอะไรบ้าง", "ขอเครดิตฟรีมีไหม", "ขอบัญชีหน่อย"
- INQUIRY CLASSIFICATION RULE:
  * If a statement is merely asking a question without reporting that an actual transaction failed or a feature broke, you MUST classify it under "other" (เรื่องอื่นๆ / สอบถามข้อมูลทั่วไป / ไม่ใช่ปัญหาของระบบ), with urgency: "low", priority: "low", department: "Support", resolution: "Solved".
  * NEVER classify inquiries under defect categories like "deposit_withdrawal", "login_issue", or "promo_bonus"! Those categories are strictly for ACTUAL FAILURES (e.g. "โอนเงินแล้วยอดไม่เข้า", "ถอนเงินแล้วดีเลย์ 2 ชั่วโมง", "เข้าสู่ระบบไม่ได้รหัสผ่านผิด", "ยอดโบนัสไม่เข้า").

CORE PRINCIPLE 3: CUSTOMER FEEDBACK & COMPLAINTS vs TECHNICAL BUGS (การบ่นเรื่องดวง vs บั๊ก)
- If a customer complains, vents, or expresses dissatisfaction about luck, winning rate, or game payouts (e.g. "เกมไม่เห็นแตกเลย มีแต่กินเอา", "เล่นแล้วเสียตลอด", "กินเงินอย่างเดียว", "ไม่แจกเลย"):
  * This is CUSTOMER FEEDBACK / VENTING, NOT a broken game engine or developer bug!
  * Classify under "feedback_complaint" (ข้อเสนอแนะและร้องเรียน) or "other", with urgency: "low" or "medium", and department: "Support".
  * NEVER route to "Developer" or classify as "game_issue"!

CORE PRINCIPLE 4: TOP-LEVEL CATEGORY & PRIORITY
- The top-level "category_id" of the JSON must represent the PRIMARY / HIGHEST SEVERITY system defect that blocks or impacts the user.
- If the chat contains ONLY inquiries, questions, context, or non-problems, the top-level "category_id" MUST be "other" (or "feedback_complaint" if venting), and priority MUST be "low".
- Set top-level "priority" and "urgency" matching the highest severity issue found.

The JSON object must have exactly these keys:
- "category_id": The ID of the matching primary category (use one of the exact IDs from the available list).
- "sub_category": A specific sub-category string identifying the issue in Thai (e.g. "หน้าเว็บโหลดช้า", "การแสดงผลรูปภาพ", "ปุ่มตอบสนองช้า").
- "intent": Primary user intent: "refund", "withdraw", "deposit", "register", "verify", "promotion", "report_issue", "complain", "inquire", "follow_up".
- "root_cause": Plausible root cause in Thai (e.g. "ประสิทธิภาพหน้าเว็บ/เซิร์ฟเวอร์โหลดช้า", "ระบบแสดงผลรูปภาพขัดข้อง", "บริบทการใช้งานทั่วไป").
- "sentiment": User's emotional state in Thai: "โกรธ", "ไม่พอใจ", "สับสน", "สงสัย", "ชมเชย", "ปกติ".
- "urgency": Urgency level: "low", "medium", "high", "urgent".
- "priority": Priority rating: "low", "medium", "high", "urgent".
- "department": Department to handle this: "Finance", "Support", "Developer", "Marketing", "Admin", "Head Admin", "VIP".
- "summary": A concise 1-sentence summary of the customer's situation in Thai.
- "keywords": An array of 2-4 key Thai keywords.
- "confidence": Float between 0.0 and 100.0.
- "recommended_reply": A brief 1-sentence polite greeting or acknowledgment in Thai.
- "resolution": Status: "Solved", "Pending", "Escalated", "Rejected", "Duplicate".
- "business_impact": Risk level: "Revenue Risk", "Customer Risk", "None".
- "business_impact_score": Float between 0.0 and 100.0.
- "ai_recommendation": Actionable recommendation for admin/support in Thai.
- "detected_issues": An array of objects representing EVERY customer statement in the chat. You MUST include EVERY customer line without skipping or omitting any sentence! Each object MUST have:
  - "issue_no": Integer (1, 2, ...).
  - "problem_summary": The verbatim sentence from the customer belonging strictly to this single category.
  - "category_id": The exact category ID for this specific issue from the available list:
    * For user context / actions (e.g. "ผมกำลังเลือกน้ำหอมอยู่ครับ"), greetings, or recovery status ("รีเฟรชแล้วกลับมาใช้งานได้ครับ"), you MUST use category_id "other" (เรื่องอื่นๆ / ไม่ใช่ปัญหา).
    * For defect statements, use the category matching the symptom.
  - "urgency": Urgency for this specific issue ("low", "medium", "high", "urgent"). For "other"/non-problem, use "low".
  - "department": Department for this specific issue ("Support", "Developer", "Finance", etc.). For "other", use "Support".
`;

  try {
    const response = await postRequest(`${OLLAMA_URL}/api/chat`, {
      model: MODEL_LLM,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this conversation:\n${conversation}` }
      ],
      stream: false,
      format: 'json',
      options: {
        num_ctx: 8192,
        temperature: 0.1
      }
    }, 900000);

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.message?.content?.trim();
    
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
      detected_issues: sanitizedIssues
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
