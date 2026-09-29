import https from 'https';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { processAgentQuery, logAgentActivity } from './agentService.js';
import { generateExcelReport } from './excelService.js';
import { 
  getCachedCategories, 
  getCategoryDisplayName, 
  findCategoryKeysByName,
  findThaiMonthInText, 
  findAllThaiMonthsInText, 
  getDynamicMonthMeta, 
  getDefaultCompanyId, 
  getPeriodThaiText 
} from './categoryHelper.js';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

export const getDynamicMonthLabels = getDynamicMonthMeta;

/**
 * Send Document (File) to Telegram chat via multipart/form-data POST
 */
export async function sendTelegramDocument(chatId, filePath, caption = '') {
  if (!TELEGRAM_BOT_TOKEN || !fs.existsSync(filePath)) {
    return { ok: false, description: 'File not found or missing token' };
  }

  return new Promise((resolve) => {
    const boundary = '----TelegramBotBoundary' + Date.now().toString(16);
    const fileName = path.basename(filePath);
    const fileData = fs.readFileSync(filePath);

    let body = [];

    // chat_id field
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`));

    // caption field
    if (caption) {
      body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`));
    }

    // parse_mode field
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nMarkdown\r\n`));

    // document field
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`));
    body.push(fileData);
    body.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const payloadBuffer = Buffer.concat(body);

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payloadBuffer.length
      }
    };

    const req = https.request(options, (res) => {
      let responseText = '';
      res.setEncoding('utf8');
      res.on('data', chunk => responseText += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseText));
        } catch (e) {
          resolve({ ok: false, error: e.message, raw: responseText });
        }
      });
    });

    req.on('error', (err) => {
      console.warn(`⚠️ [Telegram sendDocument Network Warning]: ${err.message}`);
      resolve({ ok: false, error: err.message });
    });

    req.write(payloadBuffer);
    req.end();
  });
}

/**
 * Send HTTPS request to Telegram Bot API
 */
function callTelegramAPISingle(method, payload) {
  return new Promise((resolve) => {
    if (!TELEGRAM_BOT_TOKEN) {
      console.warn('⚠️ TELEGRAM_BOT_TOKEN is not configured in .env. Telegram bot features will run in mock/simulation mode.');
      return resolve({ ok: false, description: 'Missing TELEGRAM_BOT_TOKEN' });
    }

    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${TELEGRAM_BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ ok: false, error: e.message, raw: body });
        }
      });
    });

    req.on('error', (err) => {
      console.warn(`⚠️ [Telegram API Network Warning]: ${err.message}`);
      resolve({ ok: false, error: err.message });
    });
    req.write(postData);
    req.end();
  });
}

async function callTelegramAPI(method, payload, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await callTelegramAPISingle(method, payload);
    if (res && res.ok) return res;
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
    } else {
      return res;
    }
  }
}

/**
 * Send typing indicator to Telegram chat
 */
export async function sendChatAction(chatId, action = 'typing') {
  return await callTelegramAPI('sendChatAction', { chat_id: chatId, action });
}

/**
 * Helper to send a single Telegram message chunk
 */
async function sendSingleTelegramChunk(chatId, text, parseMode = 'Markdown', replyMarkup = null) {
  let safeText = text || '';
  if (parseMode === 'Markdown') {
    safeText = safeText.replace(/([a-zA-Z0-9])_([a-zA-Z0-9])/g, '$1\\_$2');
  }

  const payload = {
    chat_id: chatId,
    text: safeText,
    parse_mode: parseMode
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  let res = await callTelegramAPISingle('sendMessage', payload);

  // Fallback Protection: If Telegram API rejects Markdown syntax or Button Data, strip formatting/buttons and retry!
  if (!res || !res.ok) {
    console.warn(`⚠️ Telegram API send error (${res?.description || res?.error}). Attempting fallback retry...`);
    const plainText = (text || '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/__/g, '')
      .replace(/_/g, '')
      .replace(/`/g, '');

    const fallbackPayload1 = { chat_id: chatId, text: plainText };
    if (replyMarkup) fallbackPayload1.reply_markup = replyMarkup;
    res = await callTelegramAPISingle('sendMessage', fallbackPayload1);

    // Secondary Retry: If reply_markup itself caused BUTTON_DATA_INVALID error, send text WITHOUT buttons!
    if (!res || !res.ok) {
      console.warn(`⚠️ Telegram API secondary retry without buttons (${res?.description || res?.error})...`);
      const fallbackPayload2 = { chat_id: chatId, text: plainText };
      res = await callTelegramAPISingle('sendMessage', fallbackPayload2);
    }
  }

  return res;
}

/**
 * Send message to Telegram chat (with optional inline keyboard buttons and auto-chunking for >4000 chars)
 */
export async function sendTelegramMessage(chatId, text, parseMode = 'Markdown', replyMarkup = null) {
  console.log(`📤 Sending Telegram response to Chat ID ${chatId}...`);

  const rawText = text || '';
  const MAX_LEN = 3800; // Safe threshold well under Telegram's 4096 char limit

  if (rawText.length <= MAX_LEN) {
    return await sendSingleTelegramChunk(chatId, rawText, parseMode, replyMarkup);
  } else {
    console.log(`✂️ Message length ${rawText.length} exceeds Telegram 3800 char limit. Splitting into chunks...`);
    const lines = rawText.split('\n');
    const chunks = [];
    let currentChunk = '';

    for (const line of lines) {
      if ((currentChunk + '\n' + line).length > MAX_LEN) {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = line;
      } else {
        currentChunk = currentChunk ? currentChunk + '\n' + line : line;
      }
    }
    if (currentChunk) chunks.push(currentChunk);

    let lastRes = null;
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const chunkMarkup = isLast ? replyMarkup : null;
      lastRes = await sendSingleTelegramChunk(chatId, chunks[i], parseMode, chunkMarkup);
      await new Promise(r => setTimeout(r, 400));
    }
    return lastRes;
  }
}

/**
 * Handle Telegram Callback Query (Inline Keyboard Button Clicks)
 */
export async function handleTelegramCallbackQuery(callbackQuery) {
  if (!callbackQuery || !callbackQuery.data || !callbackQuery.message) return null;

  const callbackId = callbackQuery.id;
  const chatId = String(callbackQuery.message.chat.id);
  const data = callbackQuery.data;
  const senderName = callbackQuery.from ? `${callbackQuery.from.first_name || ''} ${callbackQuery.from.last_name || ''}`.trim() : 'User';

  // Instantly acknowledge button click in Telegram UI so button loading spinner stops
  try {
    await callTelegramAPISingle('answerCallbackQuery', { callback_query_id: callbackId });
  } catch (e) {
    console.warn('⚠️ answerCallbackQuery warning:', e.message);
  }

  console.log(`🔘 Received Telegram Callback Query button click [${data}] from ${senderName} (Chat ID: ${chatId})`);

  const { curMonthName, lastMonthName } = getDynamicMonthLabels();
  const getPeriodThai = getPeriodThaiText;

  // Map button callback_data to Thai natural language query with short byte-compliant callback_data
  let mappedQuery = '';
  let progressMsg = '';

  if (data.startsWith('c_k:')) {
    const parts = data.split(':');
    const catKey = parts[1] || 'feedback_complaint';
    const period = parts[2] || 'today';
    const periodThai = getPeriodThai(period);
    
    const companyId = process.env.DEFAULT_COMPANY_ID || await getDefaultCompanyId();
    const categories = await getCachedCategories(companyId);
    const catTHName = getCategoryDisplayName(catKey, categories);

    mappedQuery = `ขอรายละเอียดดูแชตหมวด ${catTHName} ${periodThai}`;
    progressMsg = `⏳ **กำลังสกัดและรวบรวมรายการแชตเรื่อง ${catTHName} ${periodThai} ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 🔍✨`;
  } else if (data.startsWith('cat_name:')) {
    const parts = data.split(':');
    const catName = parts[1];
    const period = parts[2] || 'today';
    const periodThai = getPeriodThai(period);
    mappedQuery = `ขอรายละเอียดเรื่อง${catName} ${periodThai}`;
    progressMsg = `⏳ **กำลังสกัดและรวบรวมรายละเอียดแชตเรื่อง${catName} ${periodThai} ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 🔍✨`;
  } else if (data.startsWith('cat_1') || data.startsWith('drill_cat_1')) {
    const period = data.includes(':') ? data.split(':')[1] : 'today';
    const periodThai = getPeriodThai(period);
    mappedQuery = `ขอรายละเอียดหมวดที่ 1 ${periodThai}`;
    progressMsg = `⏳ **กำลังสกัดและรวบรวมรายละเอียดแชตหมวดที่ 1 ${periodThai} ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 🔍✨`;
  } else if (data.startsWith('cat_2') || data.startsWith('drill_cat_2')) {
    const period = data.includes(':') ? data.split(':')[1] : 'today';
    const periodThai = getPeriodThai(period);
    mappedQuery = `ขอรายละเอียดหมวดที่ 2 ${periodThai}`;
    progressMsg = `⏳ **กำลังสกัดและรวบรวมรายละเอียดแชตหมวดที่ 2 ${periodThai} ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 🔍✨`;
  } else if (data.startsWith('drill_hourly')) {
    const period = data.includes(':') ? data.split(':')[1] : 'today';
    const periodThai = getPeriodThai(period);
    mappedQuery = `ช่วงเวลาหนาแน่น ${periodThai} มีกี่โมง`;
    progressMsg = `⏳ **กำลังวิเคราะห์สถิติช่วงเวลาหนาแน่นของปัญหา ${periodThai} ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ ⏰✨`;
  } else if (data === 'query_today') {
    mappedQuery = 'สรุปปัญหาในวันนี้หน่อย';
    progressMsg = '⏳ **กำลังรวบรวมและสรุปข้อมูลปัญหาประจำวันนี้ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 📅✨';
  } else if (data === 'query_this_month') {
    mappedQuery = 'สรุปปัญหาในเดือนนี้หน่อย';
    progressMsg = `⏳ **กำลังรวบรวมและสรุปข้อมูลปัญหาประจำเดือน${curMonthName} ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 📊✨`;
  } else {
    mappedQuery = data;
    progressMsg = '⏳ **กำลังประมวลผลคำสั่งให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 🤖✨';
  }

  // Send immediate progress acknowledgment message to chat before AI processing
  if (progressMsg) {
    await sendTelegramMessage(chatId, progressMsg);
  }

  // Synthesize a Telegram message object to re-use handleTelegramMessage logic
  const simulatedMessage = {
    chat: callbackQuery.message.chat,
    from: callbackQuery.from,
    text: mappedQuery,
    skipProgress: true // Prevent double progress message
  };

  return await handleTelegramMessage(simulatedMessage);
}

/**
 * Process incoming Telegram Update / Message
 */
export async function handleTelegramMessage(message) {
  if (!message || !message.text || !message.chat) return null;

  const chatId = String(message.chat.id);
  const senderId = message.from ? String(message.from.id) : '';
  const isGroup = message.chat.type === 'group' || message.chat.type === 'supergroup';

  // Clean mention tag (e.g., "@Mikashu_bot สวัสดีครับ" -> "สวัสดีครับ")
  let text = message.text.trim();
  text = text.replace(/@\w+_bot\b/gi, '').trim();

  if (!text) return null; // Ignore empty message after tag removal

  const senderName = message.from ? `${message.from.first_name || ''} ${message.from.last_name || ''}`.trim() : 'User';

  console.log(`📥 Received Telegram Message [${message.chat.type}] from ${senderName} (ID: ${senderId}, Chat ID: ${chatId}): "${text}"`);

  const companyId = process.env.DEFAULT_COMPANY_ID || await getDefaultCompanyId();

  // Security & VIP Authorization Check (Evaluated Dynamically):
  const allowedIds = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  const isAuthorized = allowedIds.length === 0 || 
                       allowedIds.includes(senderId) ||
                       allowedIds.includes(chatId);

  if (!isAuthorized) {
    console.warn(`🔒 Unauthorized Telegram User ID ${senderId} (${senderName}) blocked in group ${chatId}. Logging attempt to Supabase...`);
    const unauthorizedReply = `🔒 *ขออภัยค่ะ คุณ ${senderName}*: สิทธิ์การถามคำสั่งบอทสงวนไว้เฉพาะผู้ได้รับอนุญาตเท่านั้นค่ะ`;

    // Always log unauthorized user messages to Supabase to capture Telegram User ID!
    await logAgentActivity({
      query: text,
      reply: unauthorizedReply,
      toolUsed: 'unauthorized_user_block',
      durationMs: 0,
      senderName,
      senderId,
      channel: isGroup ? 'telegram_group' : 'telegram_direct',
      companyId,
      chatId
    });

    await sendTelegramMessage(chatId, unauthorizedReply);
    return { ok: false, error: 'Unauthorized User ID' };
  }

  // Send immediate progress acknowledgment if it is a text-typed summary/drilldown query and not coming from callback
  if (!message.skipProgress) {
    const lower = text.toLowerCase();
    const { curMonthName, lastMonthName } = getDynamicMonthMeta();
    const matchedMonth = findThaiMonthInText(lower);
    const mentionedMonths = findAllThaiMonthsInText(lower);
    const isMonthlyBreakdown = lower.includes('แต่ละเดือน') || 
                               lower.includes('ทุกเดือน') || 
                               lower.includes('รายเดือน') || 
                               lower.includes('แยกตามเดือน') || 
                               lower.includes('แต่ละ เดือน') || 
                               mentionedMonths.length > 1;
    let textProgressMsg = '';

    const isCustomerQuery = lower.includes('ลูกค้า') || lower.includes('สมัคร') || lower.includes('สมาชิก') || lower.includes('ผู้ใช้') || lower.includes('ยูส') || lower.includes('ใครบ้าง') || lower.includes('มีใคร');

    if (isCustomerQuery) {
      if (lower.includes('ทักซ้ำ') || lower.includes('แจ้งเรื่องเดิม') || lower.includes('ทักเรื่องเดิม') || (lower.includes('เรื่องเดิม') && (lower.includes('ซ้ำ') || lower.includes('อีกไหม')))) {
        textProgressMsg = '⏳ **กำลังตรวจสอบประวัติการทักแชตซ้ำเรื่องเดิมของลูกค้าให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 🔄✨';
      } else if (lower.includes('ลูกค้าเก่า') && (lower.includes('เปอร์เซ็นต์') || lower.includes('เปอร์เซนต์') || lower.includes('%') || lower.includes('สัดส่วน') || lower.includes('กี่เปอร์'))) {
        textProgressMsg = '⏳ **กำลังวิเคราะห์สัดส่วนเปอร์เซ็นต์แชตจากลูกค้าเก่าให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 👥✨';
      } else if (isMonthlyBreakdown) {
        textProgressMsg = '⏳ **กำลังสืบค้นและรวบรวมข้อมูลสมาชิกใหม่แยกตามแต่ละเดือนให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 📊✨';
      } else if (lower.includes('ใครบ้าง') || lower.includes('มีใคร') || lower.includes('รายชื่อ')) {
        textProgressMsg = '⏳ **กำลังดึงรายชื่อลูกค้าให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 👤✨';
      } else if (lower.includes('เดือนที่แล้ว') || lower.includes('เดือนก่อน')) {
        textProgressMsg = `⏳ **กำลังสืบค้นและรวบรวมข้อมูลลูกค้าประจำเดือน${lastMonthName} ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 👤✨`;
      } else if (matchedMonth) {
        textProgressMsg = `⏳ **กำลังสืบค้นและรวบรวมข้อมูลลูกค้าประจำเดือน${matchedMonth.full} ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 👤✨`;
      } else if (lower.includes('เดือนนี้') || lower.includes(curMonthName)) {
        textProgressMsg = `⏳ **กำลังสืบค้นและรวบรวมข้อมูลลูกค้าประจำเดือน${curMonthName} ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 👤✨`;
      } else if (lower.includes('เมื่อวาน')) {
        textProgressMsg = '⏳ **กำลังสืบค้นและรวบรวมข้อมูลลูกค้าเมื่อวาน ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 👤✨';
      } else if (lower.includes('วันนี้')) {
        textProgressMsg = '⏳ **กำลังสืบค้นและรวบรวมข้อมูลลูกค้าประจำวันนี้ ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 👤✨';
      } else if (lower.includes('ทั้งหมด') || lower.includes('รวม') || lower.includes('ที่มี')) {
        textProgressMsg = '⏳ **กำลังสืบค้นจำนวนลูกค้าทั้งหมดในระบบให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 👤✨';
      } else {
        textProgressMsg = '⏳ **กำลังสืบค้นและรวบรวมข้อมูลลูกค้าให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 👤✨';
      }
    } else {
      if (lower.includes('หมวดที่ 1') || lower.includes('หมวด 1')) {
        textProgressMsg = '⏳ **กำลังสกัดและรวบรวมรายละเอียดแชตหมวดที่ 1 ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 🔍✨';
      } else if (lower.includes('หมวดที่ 2') || lower.includes('หมวด 2')) {
        textProgressMsg = '⏳ **กำลังสกัดและรวบรวมรายละเอียดแชตหมวดที่ 2 ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 🔍✨';
      } else if (lower.includes('วันไหน') && (lower.includes('เยอะสุด') || lower.includes('มากที่สุด') || lower.includes('หนักสุด') || lower.includes('สูงสุด'))) {
        textProgressMsg = '⏳ **กำลังวิเคราะห์สถิติวันที่มีปัญหาพุ่งสูงที่สุดให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 📅✨';
      } else if (lower.includes('ไหม') || lower.includes('หมายถึง') || lower.includes('มีใคร') || lower.includes('มีเคส')) {
        textProgressMsg = '⏳ **กำลังสืบค้นและตรวจสอบรายละเอียดปัญหาให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 🔍✨';
      } else if (isMonthlyBreakdown) {
        textProgressMsg = '⏳ **กำลังรวบรวมและสรุปข้อมูลปัญหาแยกตามแต่ละเดือนให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 📊✨';
      } else if (lower.includes('เดือนที่แล้ว') || lower.includes('เดือนก่อน')) {
        textProgressMsg = `⏳ **กำลังรวบรวมและสรุปข้อมูลปัญหาประจำเดือน${lastMonthName} ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 📊✨`;
      } else if (matchedMonth) {
        textProgressMsg = `⏳ **กำลังรวบรวมและสรุปข้อมูลปัญหาประจำเดือน${matchedMonth.full} ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 📊✨`;
      } else if (lower.includes('เดือนนี้') || lower.includes(curMonthName)) {
        textProgressMsg = `⏳ **กำลังรวบรวมและสรุปข้อมูลปัญหาประจำเดือน${curMonthName} ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 📊✨`;
      } else if (lower.includes('วันนี้') || lower.includes('ประจำวัน')) {
        textProgressMsg = '⏳ **กำลังรวบรวมและสรุปข้อมูลปัญหาประจำวันนี้ให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 📅✨';
      } else if (lower.includes('หนาแน่น') || lower.includes('ช่วงเวลา')) {
        textProgressMsg = '⏳ **กำลังวิเคราะห์สถิติช่วงเวลาหนาแน่นของปัญหาให้ค่ะ...**\nรบกวนรอสักครู่นะคะ ⏰✨';
      } else if (lower.includes('สรุปปัญหา') || lower.includes('สรุปแชท') || lower.includes('สรุปเคส')) {
        textProgressMsg = '⏳ **กำลังประมวลผลข้อมูลสรุปปัญหาแชทให้ค่ะ...**\nรบกวนรอสักครู่นะคะ 🤖✨';
      }
    }

    if (textProgressMsg) {
      await sendTelegramMessage(chatId, textProgressMsg);
    }
  }

  // Send initial typing indicator
  await sendChatAction(chatId, 'typing');

  // Start periodic typing interval (max 6 ticks / 21 seconds safety limit)
  let typingTicks = 0;
  const typingInterval = setInterval(() => {
    typingTicks++;
    if (typingTicks > 6) {
      clearInterval(typingInterval);
      return;
    }
    sendChatAction(chatId, 'typing').catch(() => {});
  }, 3500);

  try {
    // Process query through AI Agent Engine (with Queue Management & Supabase Activity Logging)
    const agentResponse = await processAgentQuery(text, companyId, {
      senderName,
      senderId,
      channel: isGroup ? 'telegram_group' : 'telegram_direct',
      chatId
    });

    // Format optional Inline Keyboard Buttons if attached
    let replyMarkup = null;
    if (agentResponse.buttons && Array.isArray(agentResponse.buttons) && agentResponse.buttons.length > 0) {
      replyMarkup = { inline_keyboard: agentResponse.buttons };
    }

    // Send formatted response to Telegram
    const result = await sendTelegramMessage(chatId, agentResponse.reply, 'Markdown', replyMarkup);

    // If Excel export requested (more than 20 items), generate and send Excel document
    if (agentResponse && agentResponse.excelExport && Array.isArray(agentResponse.excelExport.items) && agentResponse.excelExport.items.length > 0) {
      try {
        console.log(`📊 Generating Excel report for ${agentResponse.excelExport.title} (${agentResponse.excelExport.items.length} items)...`);
        const excelFilePath = await generateExcelReport(
          agentResponse.excelExport.title,
          agentResponse.excelExport.items,
          agentResponse.excelExport.periodLabel
        );

        if (excelFilePath && fs.existsSync(excelFilePath)) {
          const docCaption = `📎 **ไฟล์รายงานสถิติปัญหาฉบับเต็ม (.xlsx)**\nประจำ${agentResponse.excelExport.periodLabel || 'ปัจจุบัน'} (รวม **${agentResponse.excelExport.items.length} รายการ**)`;
          await sendTelegramDocument(chatId, excelFilePath, docCaption);
          console.log(`✅ Telegram Excel document sent successfully to chat ${chatId}: ${excelFilePath}`);
        }
      } catch (excelErr) {
        console.error('Error sending Telegram Excel document:', excelErr.message);
      }
    }

    return result;
  } catch (err) {
    console.error('Error processing Telegram message:', err.message);
    await sendTelegramMessage(chatId, '⚠️ ขออภัยค่ะ เกิดข้อผิดพลาดในการประมวลผลคำสั่ง กรุณาลองใหม่อีกครั้งนะคะ');
    return { ok: false, error: err.message };
  } finally {
    clearInterval(typingInterval);
  }
}

/**
 * Telegram Long Polling Manager (Runs in background if enabled)
 */
let isPolling = false;
let lastUpdateId = 0;

export function startTelegramPolling() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('ℹ️ Telegram Polling not started: TELEGRAM_BOT_TOKEN is not defined in .env.');
    return;
  }

  if (isPolling) return;
  isPolling = true;

  console.log('🤖 Starting Telegram Bot Long-Polling Loop...');

  const poll = async () => {
    if (!isPolling) return;
    try {
      const res = await callTelegramAPI('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 20
      });

      if (res && res.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          lastUpdateId = update.update_id;
          if (update.message) {
            await handleTelegramMessage(update.message);
          } else if (update.callback_query) {
            await handleTelegramCallbackQuery(update.callback_query);
          }
        }
      }
    } catch (err) {
      console.error('Error in Telegram Polling loop:', err.message);
    } finally {
      if (isPolling) {
        setTimeout(poll, 1000);
      }
    }
  };

  poll();
}

export function stopTelegramPolling() {
  isPolling = false;
  console.log('🛑 Telegram Polling stopped.');
}

/**
 * Register Webhook URL with Telegram API
 */
export async function setTelegramWebhook(webhookUrl) {
  stopTelegramPolling();
  console.log(`🌐 Deleting previous Telegram Webhook registration...`);
  await callTelegramAPI('deleteWebhook', { drop_pending_updates: true });

  console.log(`🌐 Registering fresh Telegram Webhook URL: ${webhookUrl}...`);
  const res = await callTelegramAPI('setWebhook', {
    url: webhookUrl,
    drop_pending_updates: true
  });
  if (res && res.ok) {
    console.log(`🎉 SUCCESS: Fresh Telegram Webhook set successfully to ${webhookUrl}!`);
  } else {
    console.error(`❌ Failed to set Telegram Webhook:`, res?.description || res);
  }
  return res;
}

/**
 * Initialize Telegram Bot (Uses Direct Long-Polling Mode for 100% Guaranteed Reliability)
 */
export async function initTelegramBot() {
  console.log(`⚡ Initializing Telegram Bot in Direct Long-Polling Mode...`);
  await callTelegramAPI('deleteWebhook', { drop_pending_updates: true });
  startTelegramPolling();
}
