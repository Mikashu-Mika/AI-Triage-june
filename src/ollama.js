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

  const systemPrompt = `You are an AI Customer Intelligence Platform. Analyze the customer chat conversation and respond with a JSON object.
Do NOT include any markdown code blocks, explanation, or extra characters. Only output the JSON object.

CRITICAL LANGUAGE RULE: ALL text output in the JSON (summary, recommended_reply, root_cause, etc.) MUST be in Thai language ONLY. Do NOT use Chinese, English, or any other language in the output values. If you are unsure how to express something, use Thai.

CRITICAL DIRECTIVE ON FEW-SHOT EXAMPLES:
You MUST strictly align your output categorization with the FEW-SHOT TRAINING EXAMPLES below. If the input conversation matches or is highly similar to any training example, you MUST copy the category_id, intent, priority, and department directly from that training example's expected output.

${examplesPrompt}
CRITICAL CLASSIFICATION RULE (CRITERIA FOR PROBLEMS VS INQUIRIES):
You must strictly distinguish between actual system/financial problems (errors, delays, bugs, failures) and normal transactions or FAQ inquiries.

CRITICAL RULE ON SYSTEM BLOCKERS VS GENERAL TRANSACTIONS (PREVENT KEYWORD HIJACKS):
- A system/technical blocker is any case where the customer reports they cannot view, load, access, click, or play (e.g., "ดูไม่ได้" (cannot watch/stream/load), "เข้าไม่ได้" (cannot login/access), "กดไม่ได้" (cannot click), "จอเขียว/จอขาว" (blank/color screen), "ค้าง" (frozen/stuck), "ช้า" (slow/lag)).
- A transaction or inquiry is any case where the customer asks to perform a normal operation (e.g., asking for bank details "ขอบช", asking for a bonus "ขอโบนัส", asking for a promotion, asking for a link).
- If a conversation contains BOTH a system blocker and a transaction/inquiry, the primary problem (at the top level of the JSON) is ALWAYS the system blocker! You MUST classify the chat under the category representing that specific blocker (such as the loading, rendering, or access issue categories available in the list), and NOT under the transaction/inquiry categories.
- However, in the "detected_issues" array, you MUST still list any distinct inquiries/requests as separate items under "other" (หมวดหมู่อื่นๆ / ไม่ใช่ปัญหา) if they are normal inquiries or questions (such as asking for promotions/credits "เครดิตฟรีมีไหม", "มีโปรอะไรบ้าง", asking for bank details "ขอบช"). Do NOT classify normal promotion inquiries under "promo_bonus" (which is strictly for promotion errors, delays, or failure to receive bonuses). Do NOT omit them from the "detected_issues" array just because they are not technical blockers.
- Set resolution to "Pending", and priority to "medium" or "high" because the user is blocked from using the system.

CRITICAL RULE ON SEMANTIC PROBLEM GROUPING & DISTINCT CATEGORIES (KRU SAM LOGIC):
- Do NOT classify duplicate sentences of the SAME issue blindly line-by-line (e.g., group "ฝากเงินไปแล้ว", "เงินถูกหักแล้ว", "ยอดเงินยังไม่เข้า", "รายการแจ้งว่าสำเร็จ" into 1 single issue "ฝากเงินแล้วยอดไม่เข้าระบบ" under category_id "deposit_withdrawal").
- HOWEVER, every DIFFERENT category problem reported in the chat MUST be extracted as its own separate issue object in "detected_issues"! NEVER combine two different categories into a single issue object!
- For example:
  - "ฝากเงินแล้วยอดไม่เข้า" -> category_id: "deposit_withdrawal" (Primary Issue)
  - "กดรีเฟรชแล้วหน้าเว็บค้าง" -> category_id: "page_load_freeze" (Secondary Issue A)
  - "ระบบขึ้น Service Unavailable" -> category_id: "api_error" (Secondary Issue B)
- When a chat contains these 3 distinct problems, you MUST output EXACTLY 3 separate issues in "detected_issues" covering "deposit_withdrawal", "page_load_freeze", and "api_error".

CRITICAL RULE ON API ERROR & SERVICE UNAVAILABLE:
- Any message mentioning "Service Unavailable", "API Error", "Server Error", "Timeout", "Internal Error", "503", "502", "504" MUST be classified under category_id "api_error" (ระบบขัดข้อง/API Error).
- "Service Unavailable" is ALWAYS an "api_error", NEVER classify it as "other"!

CRITICAL RULE ON ACCOUNT SECURITY & ACCOUNT CHANGES:
- Any message about changing account details (e.g. "เปลี่ยนรหัสผ่าน", "เปลี่ยนนามสกุล", "เปลี่ยนเบอร์โทร", "เปลี่ยนอีเมล", "ใครมาเปลี่ยนรหัส", "บัญชีถูกแฮก", "ยืนยันตัวตน") MUST be classified as "account_security". These are NOT general inquiries!
- If the customer reports that someone else changed their password without permission (e.g. "ใครมาเปลี่ยนรหัสผ่าน"), this is a HIGH PRIORITY security incident. Set urgency to "high" and department to "Admin".
- Account modification requests (name change, password change, phone number change) are real issues that require admin verification, NOT normal inquiries.

CRITICAL RULE ON DISPLAY GLITCHES & BLANK SCREENS:
- Any message mentioning screen display glitches (e.g. "มืด", "จอมืด", "จอดำ", "หน้าจอมืด", "มืดเหมือนเดิม", "จอขาว", "หน้าจอขาว", "จอเขียว") MUST be classified as "ui_rendering_issue" (การแสดงผลผิดเพี้ยน). Screen display glitches are ALWAYS real technical problems and MUST NEVER be classified as "other"!

CRITICAL RULE ON HTTP ERRORS & ACCESS BLOCKED:
- Any message mentioning HTTP error codes or page access errors (e.g. "Error 403", "ขึ้น Error 403", "Error 502", "Error 504", "Error 404", "Error 500", "Error 503", "Error", "เข้าเว็บไม่ได้", "หน้าเว็บไม่ขึ้น", "ลิงก์เสีย") MUST be classified as "access_blocked" (เข้าหน้าเว็บไม่ได้/ลิงก์เสีย).
- HTTP Error messages are ALWAYS real technical problems and MUST NEVER be classified as "other"!

CRITICAL RULE ON NOTIFICATION ISSUES VS LOGIN ISSUES:
- Any issue mentioning not receiving SMS, not receiving OTP, OTP not sending, not receiving email ("ไม่ได้รับ OTP", "OTP ไม่ส่ง", "ไม่ได้รับ SMS", "ไม่ได้รับอีเมล", "OTP ไม่เข้า", "แจ้งเตือนล่าช้า") MUST be categorized as "notification_issue" (ปัญหาการแจ้งเตือน). Do NOT classify OTP/SMS delivery failures as "login_issue".
- Even if the customer was attempting to reset password or log in when the OTP failed, the specific problem of OTP/SMS/email non-delivery MUST be assigned category_id "notification_issue" in detected_issues.
- NEVER combine a login/password reset problem ("ลืมรหัสผ่าน/เข้าไม่ได้") with an OTP/SMS non-delivery problem into a single issue object! You MUST split them into TWO SEPARATE issues in detected_issues:
  1. Issue A: "ลืมรหัสผ่าน/บัญชีถูกล็อก" -> category_id: "login_issue"
  2. Issue B: "ไม่ได้รับ OTP ทางอีเมลและ SMS" -> category_id: "notification_issue"

1. Normal Requests & General Inquiries (e.g. asking for bank account "ขอบช", asking to make a normal deposit "ฝากตัง", asking to change bank account details "เปลี่ยนบัญชี"/"ขอเปลี่ยนเลขบัญชี" without errors, asking to help register "สมัครให้หน่อย"/"ขอลิงก์สมัคร" without errors, asking how referral works "แนะนำเพื่อนได้อะไร", asking for promo codes / claiming normal benefits "ขอโบนัสไทม์", asking for free credit "เครดิตฟรีมีไหม", "มีโปรอะไรบ้าง", "ขอเครดิตฟรี" without errors):
   - These are NOT problems!
   - You MUST classify these as "other" (หมวดหมู่อื่นๆ / ไม่ใช่ปัญหา). Do NOT classify them under "deposit_withdrawal", "login_issue", "registration", "account_security", or "promo_bonus" because those categories are strictly reserved for actual SYSTEM/FINANCIAL ISSUES, ERRORS, PROCESS FAILURES, OR SECURITY HACKS/THREATS.
   - For example, "สมัครให้หน่อย" is a request for registration assistance (other), whereas "สมัครสมาชิกไม่ได้" is a registration failure (registration). "เปลี่ยนบัญชี" is a standard request to update bank account info (other), whereas "ใครมาเปลี่ยนรหัสผ่าน" is a security incident (account_security).
   - Set "resolution" to "Solved" (because it is a standard inquiry that can be replied immediately without technical action).
   - Set "urgency" to "low" and "priority" to "low".
   - Set "business_impact" to "None" and "business_impact_score" to 0.0.
   - Set "department" to "Support".
   - Set "root_cause" to "None (General Inquiry / Standard Request)".

2. Actual System Issues & Failures (e.g. promo errors "แนะนำเพื่อนแล้วไม่ได้รางวัลหรือเครดิตเพิ่มเติม", "ทำไมซื้อของแล้วแต้มสะสมไม่ขึ้น", "ทำไมถึงไม่ได้สิทธิ์แลกสินค้าฟรี", deposit delays "โอนเงินแล้วยอดไม่ขึ้น", withdrawal delays "ถอนเงินช้ามากครึ่งชั่วโมงแล้ว", access errors "เข้าสู่ระบบไม่ได้", "เว็บค้างหน้าดาวน์โหลด"):
   - These are actual issues!
   - Classify them under the matching category (e.g., "promo_bonus" for bonus/promotion errors/delays, "deposit_withdrawal" for deposit delays, "login_issue" for access issues, etc.).
   - Set "resolution" to "Pending" (or "Escalated" if it requires another department).
   - Set "urgency" and "priority" based on the severity (medium, high, urgent).

3. PRIORITIZE SYSTEM BLOCKERS OVER GENERAL REQUESTS/PROMOTIONS:
   - If the conversation contains any active technical/system blocker, display error, or system failure (e.g., "ดูไม่ได้" (cannot watch/load), "ค้าง" (frozen), "กดไม่ได้" (cannot click), "เข้าไม่ได้" (cannot login), "จอขาว/โหลดช้า"), you MUST prioritize this technical issue as the primary category (e.g., "page_load_freeze", "interaction_lag", "ui_rendering_issue", "game_issue") over any general request or promotion claim in the same conversation.
   - For example: if a customer says "ดูไม่ได้ แจ้งรับโบนัสครับ", the core blocker is "ดูไม่ได้" (cannot watch/load the game/page) which is a technical issue. You must classify this under "page_load_freeze" or "game_issue", set "resolution" to "Pending", and set priority to "medium" or "high", rather than classifying it as a promotion claim (promo_bonus).

LANGUAGE & SHORT MESSAGES RULE:
- All generated text fields ("summary", "recommended_reply", "ai_recommendation", "sub_category", "root_cause") MUST be in polite, professional Thai language.
- Do NOT output any system instructions, guidelines, or meta-comments inside the JSON values.
- If the conversation is extremely short (e.g. "ฝากตัง", "ขอบช"), do not complain about lack of details. Generate a standard polite reply asking for more details or providing standard information (e.g., for "ขอบช" you can write: "สวัสดีค่ะ นี่คือรายละเอียดบัญชีธนาคารสำหรับโอนเงินค่ะ...", for "ฝากตัง" write: "สวัสดีค่ะ คุณลูกค้าสามารถทำรายการฝากเงินได้ที่เมนูฝากถอนหน้าเว็บไซต์ได้เลยค่ะ").

CRITICAL RULE ON RECOMMENDED REPLIES (OVERRIDING FEW-SHOT EXAMPLES):
- For any issue in the "detected_issues" array or the main "recommended_reply" classified under "deposit_withdrawal" (การเงินและการชำระเงิน/ยอดเงินไม่เข้า/ดีเลย์):
  You MUST IGNORE the reply style of the few-shot training examples. Instead, you MUST strictly generate a reply that guides the customer and asks for their transfer slip ("สลิปโอนเงิน") to initiate the verification step, using this exact pattern or very similar:
  "สวัสดีค่ะ รบกวนขอสลิปโอนเงินของคุณลูกค้า เพื่อให้ทางแอดมิน/ทีมงาน ดำเนินการตรวจสอบการทำรายการชำระเงินในระบบ และหากรายการถูกต้อง เจ้าหน้าที่จะเร่งปรับปรุงยอดเงินให้โดยเร็วที่สุดค่ะ"

CRITICAL RULE ON DEPARTMENT ROUTING:
- "Head Admin": Use for severe system outages (e.g. "ระบบหลักล่ม", "เซิร์ฟเวอร์หลักปิดปรับปรุง"), severe account takeover security incidents, or urgent administrative escalations.
- "Developer": Use ONLY for internal website/app bugs, UI display glitches, button click issues, or internal website loading errors ("ปุ่มกดทับซ้อน", "หน้าเว็บค้าง", "ตัวหนังสือเบี้ยว", "โหลดหน้าเว็บไม่ขึ้น").
- "Finance": Use for payment/transaction delays, transfer slip verification, and monetary balance adjustments.
- "Support": Use for general customer assistance, password reset guidance, and standard inquiries.
- "Marketing": Use for promotions, bonuses, referral programs, and marketing campaigns.

The JSON object must have exactly these keys:
- "category_id": The ID of the matching category. Use one of these exact IDs:
${categoriesPromptList || '- "other": หมวดหมู่อื่นๆ'}
- "sub_category": A specific sub-category string identifying the issue (e.g. "ชำระเงินล่าช้า", "ลืมรหัสผ่าน", "ปุ่มกดยืนยันไม่ได้").
- "intent": The primary user intent. Use one of: "refund", "withdraw", "deposit", "register", "verify", "promotion", "report_issue", "complain", "inquire", "follow_up".
- "root_cause": The root cause of the issue (e.g. "ธนาคารขัดข้อง", "ระบบตรวจสอบดีเลย์", "ปัญหาระบบอินเทอร์เน็ตของผู้ใช้งาน", "เงื่อนไขโปรโมชั่นยังไม่ครบถ้วน").
- "sentiment": The user's emotional state. Use one of: "โกรธ", "ไม่พอใจ", "สับสน", "สงสัย", "ชมเชย", "ปกติ".
- "urgency": The urgency level. Use one of: "low", "medium", "high", "urgent".
- "priority": The priority rating. Use one of: "low", "medium", "high", "urgent".
- "department": The department that should handle this. Use one of: "Finance", "Support", "Developer", "Marketing", "Admin", "Head Admin", "VIP".
- "summary": A brief 1-sentence summary of the customer's problem in Thai language.
- "keywords": An array of 2-4 important keywords in Thai language.
- "confidence": A float number between 0.0 and 100.0 representing your confidence.
- "recommended_reply": A recommended response draft in Thai language, addressing the customer politely and offering a clear instruction or resolution based on their issue.
- "resolution": The resolution status of the ticket. Use one of: "Solved", "Pending", "Escalated", "Rejected", "Duplicate".
- "business_impact": The business risk associated with this issue. Use one of: "Revenue Risk" (if it affects payment/transactions), "Customer Risk" (if they are angry or threaten to leave), "None".
- "business_impact_score": A float number between 0.0 and 100.0 representing the impact score (higher means worse impact).
- "ai_recommendation": Proactive suggestions to prevent or solve this (e.g. "แนะนำเช็คระบบ API ธนาคารด่วน", "แนะนำเพิ่มข้อมูลวิธีใช้งานใน FAQ", "แนะนำแอดมินส่งต่อหน้าจอตรวจสอบยอดค้าง").
- "detected_issues": An array of objects representing each separate problem and non-problem part found in the chat. Each object must have exactly these keys:
  - "issue_no": An integer (1, 2, ...).
  - "problem_summary": The EXACT FULL VERBATIM SENTENCE(S) quoted directly from the customer's conversation that belong to this category, joined by " / " (e.g. "ฝากเงินไม่ได้ครับ / โอนแล้ว / เงินออกจากบัญชีแล้ว"). NEVER summarize, paraphrase, or truncate into short abstract phrases!
  - "category_id": The matching category ID for this problem from the available categories list. Any non-problem sentences (greetings, asking what to do, general context, closing polite follow-up) MUST be placed under category_id "other" (which displays on the dashboard as "ไม่ใช่ปัญหา").
  - "urgency": The urgency level for this specific problem (low, medium, high, urgent). For "other" non-problem issues, use "low".
  - "department": The department for this specific problem (Finance, Support, Developer, Marketing, Admin, Head Admin, VIP). For "other", use "Support".
  - "recommended_reply": A polite response draft in Thai addressing this specific problem.

Example:
{
  "category_id": "deposit_withdrawal",
  "sub_category": "ยอดเงินไม่อัปเดต",
  "intent": "deposit",
  "root_cause": "ธนาคารขัดข้องชั่วคราว",
  "sentiment": "ไม่พอใจ",
  "urgency": "high",
  "priority": "high",
  "department": "Finance",
  "summary": "ลูกค้าแจ้งว่าโอนเงินเข้ามาแล้วระบบไม่ปรับยอดอัตโนมัติเนื่องจากธนาคารปลายทางขัดข้อง",
  "keywords": ["โอนเงิน", "ยอดไม่เข้า", "ยอดเงิน"],
  "confidence": 95.50,
  "recommended_reply": "สวัสดีค่ะ รบกวนขอสลิปโอนเงินของคุณลูกค้า เพื่อให้ทางแอดมินดำเนินการตรวจสอบการทำรายการชำระเงินในระบบ และเร่งปรับปรุงยอดเงินให้โดยเร็วที่สุดค่ะ",
  "resolution": "Escalated",
  "business_impact": "Revenue Risk",
  "business_impact_score": 90.0,
  "ai_recommendation": "แนะนำแอดมินส่งต่อไปยังแผนก Finance ทันที และให้ประสานงาน Developer เช็ค API Gateway",
  "detected_issues": [
    {
      "issue_no": 1,
      "problem_summary": "ฝากเงินไม่ได้ครับ / โอนแล้ว / เงินออกจากบัญชีแล้ว / แต่เครดิตยังไม่เข้า",
      "category_id": "deposit_withdrawal",
      "urgency": "high",
      "department": "Finance",
      "recommended_reply": "สวัสดีค่ะ รบกวนขอสลิปโอนเงินของคุณลูกค้า เพื่อให้ทางทีมงานดำเนินการตรวจสอบและปรับปรุงยอดเงินให้โดยเร็วที่สุดค่ะ"
    },
    {
      "issue_no": 2,
      "problem_summary": "ต้องทำยังไง / ช่วยดูให้ที",
      "category_id": "other",
      "urgency": "low",
      "department": "Support",
      "recommended_reply": "สวัสดีค่ะ เจ้าหน้าที่รับเรื่องเรียบร้อยและกำลังตรวจสอบให้ค่ะ"
    }
  ]
}`;

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
