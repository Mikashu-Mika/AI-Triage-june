import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { supabase, getPendingChats, updateTriageResult, updateChatIssues, authenticateCompany, initializeCompanyCategories, getCategories, authenticateUser, getAllUsers, createUser, updateUser, deleteUser, getAllCompanies, getAllCustomers, createCustomer, updateCustomer, deleteCustomer, updateCompanyPackage, ROLE_HIERARCHY } from './supabase.js';
import { getEmbedding } from './ollama.js';
import { runTriagePipeline, processSingleChat } from './triageService.js';
import { extractTextFromImage } from './ocr.js';
import { processAgentQuery } from './agentService.js';
import { handleTelegramMessage, handleTelegramCallbackQuery, startTelegramPolling, initTelegramBot, setTelegramWebhook } from './telegramBot.js';
import { enforceCompanyQuota, checkCompanyQuota, PACKAGE_CONFIG } from './quotaService.js';
import { waitForInteractiveIdle, isInteractiveActive, getInteractiveCount, setTriageQueueStateGetter, getQueueMetrics } from './aiScheduler.js';

dotenv.config();

// Simple background triage queue to process requests sequentially and avoid overloading CPU/Ollama
const triageQueue = [];
let isQueueProcessing = false;
let currentProcessingChatId = null;

// Connect AI Scheduler with Triage Queue state for real-time monitoring & metrics
setTriageQueueStateGetter(() => ({
  queueLength: triageQueue.length,
  currentChatId: currentProcessingChatId,
  isProcessing: isQueueProcessing
}));

function enqueueTriage(chatId) {
  // Avoid duplicate entries in queue
  if (!triageQueue.includes(chatId)) {
    triageQueue.push(chatId);
  }
  processTriageQueue();
}

async function processTriageQueue() {
  if (isQueueProcessing || triageQueue.length === 0) return;

  // Priority Check: If any Telegram query is active or waiting, PAUSE background triage!
  if (isInteractiveActive()) {
    console.log(`⏸️ [Priority Queue] Telegram task is active (${getInteractiveCount()} pending). Pausing triage queue...`);
    await waitForInteractiveIdle('Triage Queue');
    console.log(`▶️ [Priority Queue] Resuming triage queue after Telegram completed.`);
  }

  if (triageQueue.length === 0) return;

  isQueueProcessing = true;

  const nextChatId = triageQueue.shift();
  currentProcessingChatId = nextChatId;
  console.log(`[Queue] Starting background triage for chat ${nextChatId} (Remaining in queue: ${triageQueue.length})`);
  try {
    await processSingleChat(nextChatId);
  } catch (err) {
    console.error(`[Queue] Background triage failed for ${nextChatId}:`, err.message);
  } finally {
    currentProcessingChatId = null;
    isQueueProcessing = false;
    processTriageQueue();
  }
}

// Background scanner to auto-enqueue any un-triaged or incomplete chats from database
let isScanningPending = false;
async function scanAndEnqueuePendingChats(isStartup = false) {
  // If Telegram query is currently active or waiting, skip background scan to yield CPU/DB
  if (isInteractiveActive()) {
    console.log(`⏸️ [Priority Scanner] Telegram query active. Skipping background scan.`);
    return;
  }

  if (isScanningPending) return;
  isScanningPending = true;
  try {
    const { data: orphaned, error: err1 } = await supabase
      .from('chats')
      .select('id, status, embedding, summary, category_id, chat_issues(id, recommended_reply)')
      .or('status.eq.pending,embedding.is.null')
      // failed / quota_exceeded chats must not be retried automatically (avoids endless re-triage loops)
      .not('status', 'in', '(quota_exceeded,failed)')
      .order('created_at', { ascending: false })
      .limit(50);

    if (err1) throw err1;

    // Fast-path: If a chat already has summary, category_id, and chat_issues (AI or human-audited),
    // it only needs embedding and status='completed' (fast path: <1s instead of 60s LLM re-triage)
    const trulyUnprocessed = [];
    for (const chat of (orphaned || [])) {
      const hasIssues = Array.isArray(chat.chat_issues) && chat.chat_issues.length > 0;
      if (chat.summary && chat.category_id && hasIssues) {
        if (!chat.embedding) {
          getEmbedding(chat.summary).then(emb => {
            supabase.from('chats').update({ status: 'completed', embedding: emb }).eq('id', chat.id).then();
          }).catch(() => {
            supabase.from('chats').update({ status: 'completed' }).eq('id', chat.id).then();
          });
        } else if (chat.status === 'pending') {
          supabase.from('chats').update({ status: 'completed' }).eq('id', chat.id).then();
        }
      } else {
        trulyUnprocessed.push(chat.id);
      }
    }

    // Also check recent chats that have 0 issues in chat_issues or no summary
    // (human-audited issues carry a recommended_reply and must never be re-triaged/overwritten)
    const { data: allRecent, error: err2 } = await supabase
      .from('chats')
      .select('id, summary, chat_issues(id)')
      .not('status', 'in', '(quota_exceeded,failed)')
      .order('created_at', { ascending: false })
      .limit(30);

    if (err2) throw err2;

    const missingIssues = (allRecent || []).filter(c => (
      !c.summary ||
      !c.chat_issues ||
      c.chat_issues.length === 0
    ));
    const toEnqueue = new Set([
      ...trulyUnprocessed,
      ...missingIssues.map(c => c.id)
    ]);

    // Exclude the chat currently being processed and chats already waiting in queue
    const newItems = Array.from(toEnqueue).filter(id => id !== currentProcessingChatId && !triageQueue.includes(id));

    if (newItems.length > 0) {
      console.log(`[Queue] ${isStartup ? 'Startup scan' : 'Background auto-scanner'} found ${newItems.length} un-triaged chats in database. Auto-enqueueing...`);
      newItems.forEach(id => enqueueTriage(id));
    }
  } catch (err) {
    if (isStartup) {
      console.error('Failed to auto-enqueue un-triaged chats on startup:', err.message);
    }
  } finally {
    isScanningPending = false;
  }
}

// 1. Initial scan on server startup
scanAndEnqueuePendingChats(true);

// 2. Continuous background polling safeguard (every 10 seconds)
setInterval(() => {
  scanAndEnqueuePendingChats(false);
}, 10000);

// 3. Supabase Realtime event listener for instant 0-second detection
function initRealtimeListener() {
  try {
    supabase
      .channel('chats-realtime-listener')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chats' },
        (payload) => {
          const newChat = payload.new;
          if (newChat && newChat.id) {
            console.log(`⚡ [Realtime] New chat inserted (${newChat.id}). Auto-enqueueing for Sift AI classification...`);
            enqueueTriage(newChat.id);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chats' },
        (payload) => {
          const updated = payload.new;
          // Only re-enqueue chats explicitly set back to pending; status updates written by triage itself
          // (failed / quota_exceeded / completed without embedding) would otherwise loop forever
          if (updated && updated.id && updated.status === 'pending') {
            if (updated.id !== currentProcessingChatId && !triageQueue.includes(updated.id)) {
              console.log(`⚡ [Realtime] Chat ${updated.id} status is pending/incomplete. Auto-enqueueing...`);
              enqueueTriage(updated.id);
            }
          }
        }
      )
      .subscribe((status) => {
        console.log(`📡 [Realtime] Supabase chat subscription status: ${status}`);
      });
  } catch (err) {
    console.warn('⚠️ [Realtime] Failed to initialize Supabase realtime listener:', err.message);
  }
}

initRealtimeListener();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// Serve web UI for package and quota management
app.get('/packages', (req, res) => {
  res.sendFile(path.resolve('public/packages.html'));
});

const PORT = process.env.PORT || 4000;

// Middleware: Authenticate company using Client ID and Client Secret
async function authCompany(req, res, next) {
  const clientId = req.headers['x-client-id'] || req.body.client_id || req.query.client_id;
  const clientSecret = req.headers['x-client-secret'] || req.body.client_secret || req.query.client_secret;

  if (!clientId || !clientSecret) {
    return res.status(401).json({ error: 'Unauthorized: Missing Client ID or Client Secret credentials.' });
  }

  try {
    const company = await authenticateCompany(clientId, clientSecret);
    if (!company) {
      return res.status(401).json({ error: 'Unauthorized: Invalid Client ID or Client Secret.' });
    }
    req.company = company; // Expose company { id, name }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error during authentication: ' + err.message });
  }
}

// Admin key must come from the environment (never a hard-coded default, since the repo is public)
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
if (!ADMIN_API_KEY || ADMIN_API_KEY.length < 32) {
  console.error('[Startup] ADMIN_API_KEY is missing or too short (min 32 chars). Set it in .env, e.g. `openssl rand -hex 32`.');
  process.exit(1);
}

// Middleware: Authenticate admin using X-Admin-Key or user credentials (system_admin / super_admin)
async function authAdminOrKey(req, res, next) {
  const adminKey = req.headers['x-admin-key'] || req.query.admin_key || req.body?.admin_key;
  if (adminKey && adminKey === ADMIN_API_KEY) {
    req.isAdmin = true;
    return next();
  }

  // Fallback to user credentials if provided
  const email = req.headers['x-user-email'];
  const password = req.headers['x-user-password'];
  if (email && password) {
    try {
      const user = await authenticateUser(email, password);
      if (user && (user.role === 'system_admin' || user.role === 'super_admin')) {
        req.user = user;
        req.isAdmin = true;
        return next();
      }
      return res.status(403).json({ error: 'Forbidden: Admin privileges required.' });
    } catch (err) {
      return res.status(500).json({ error: 'Auth error: ' + err.message });
    }
  }

  return res.status(401).json({ error: 'Unauthorized: Admin authentication required (X-Admin-Key or admin credentials).' });
}

// Middleware: Authenticate either Company (Client ID/Secret) or Admin (X-Admin-Key / User credentials)
async function authCompanyOrAdmin(req, res, next) {
  const adminKey = req.headers['x-admin-key'] || req.query.admin_key || req.body?.admin_key;
  if (adminKey && adminKey === ADMIN_API_KEY) {
    req.isAdmin = true;
    req.company = { id: req.body?.company_id || req.query?.company_id || null, name: 'Admin Override' };
    return next();
  }

  const email = req.headers['x-user-email'];
  const password = req.headers['x-user-password'];
  if (email && password) {
    try {
      const user = await authenticateUser(email, password);
      if (user) {
        req.user = user;
        req.company = { id: user.company_id, name: user.name };
        return next();
      }
      return res.status(401).json({ error: 'Unauthorized: Invalid email or password.' });
    } catch (err) {
      return res.status(500).json({ error: 'Auth error: ' + err.message });
    }
  }

  const clientId = req.headers['x-client-id'] || req.body?.client_id || req.query?.client_id;
  const clientSecret = req.headers['x-client-secret'] || req.body?.client_secret || req.query?.client_secret;

  if (clientId && clientSecret) {
    try {
      const company = await authenticateCompany(clientId, clientSecret);
      if (company) {
        req.company = company;
        return next();
      }
      return res.status(401).json({ error: 'Unauthorized: Invalid Client ID or Client Secret.' });
    } catch (err) {
      return res.status(500).json({ error: 'Authentication error: ' + err.message });
    }
  }

  return res.status(401).json({ error: 'Unauthorized: Missing company credentials or Admin key.' });
}

/**
 * Resolve a caller-supplied category ID (e.g. 'login_issue' or '<company>:login_issue')
 * to the company's own prefixed category ID. Returns null when the company has no such category.
 * @param {string} rawId
 * @param {string} companyId
 * @returns {Promise<string|null>}
 */
async function resolveCompanyCategoryId(rawId, companyId) {
  if (!rawId || !companyId) return null;
  const key = String(rawId).split(':').pop().trim().toLowerCase();
  const categories = await getCategories(companyId);
  const match = categories.find(c => c.company_id === companyId && c.id.split(':').pop().toLowerCase() === key);
  return match ? match.id : null;
}

// Setup MCP Server instance
const mcpServer = new Server(
  {
    name: 'sift-ai-mcp-server',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Define MCP Tools
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_unclassified_chats',
        description: 'ดึงข้อมูลแชตของลูกค้าที่ยังไม่ได้คัดแยก (status = pending)',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'save_triage_result',
        description: 'บันทึกผลลัพธ์การคัดแยก และคำนวณเวกเตอร์ embedding ด้วย bge-m3 เพื่ออัปเดตลง Supabase',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'รหัส ID ของแชต' },
            category_id: { type: 'string', description: 'รหัสหมวดหมู่แชต (เช่น deposit_withdrawal, login_issue)' },
            priority: { type: 'string', description: 'ระดับความสำคัญ (low, medium, high, urgent)' },
            summary: { type: 'string', description: 'บทสรุปความต้องการของลูกค้าสั้นๆ เป็นภาษาไทย' },
            detected_issues: {
              type: 'array',
              description: 'รายการประเด็นปัญหาย่อยที่วิเคราะห์ได้จาก Qwen 2.5 14B'
            }
          },
          required: ['id', 'category_id', 'priority', 'summary']
        }
      },
      {
        name: 'run_triage_pipeline',
        description: 'รันกระบวนการคัดแยกแชตค้างประมวลผลทั้งหมดอัตโนมัติ ด้วย qwen2.5:14b (วิเคราะห์) และ bge-m3 (embedding)',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// Handle MCP Tool Execution
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'get_unclassified_chats') {
      const chats = await getPendingChats();
      return {
        content: [{ type: 'text', text: JSON.stringify(chats, null, 2) }]
      };
    } 
    
    if (name === 'save_triage_result') {
      const { id, category_id, priority, summary, detected_issues } = args;
      const { data: chatRec } = await supabase.from('chats').select('company_id').eq('id', id).maybeSingle();
      if (!chatRec) throw new Error(`Chat ${id} not found`);
      const resolvedCategoryId = await resolveCompanyCategoryId(category_id, chatRec.company_id);
      if (!resolvedCategoryId) throw new Error(`Unknown category_id for this chat's company: ${category_id}`);

      const embedding = await getEmbedding(summary);
      const updated = await updateTriageResult(id, {
        category_id: resolvedCategoryId,
        priority,
        summary,
        embedding
      });
      if (detected_issues && Array.isArray(detected_issues) && detected_issues.length > 0) {
        const resolvedIssues = [];
        for (const issue of detected_issues) {
          resolvedIssues.push({
            ...issue,
            category_id: (await resolveCompanyCategoryId(issue.category_id, chatRec.company_id)) || resolvedCategoryId
          });
        }
        await saveChatIssues(id, resolvedIssues);
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ message: 'บันทึกผลสำเร็จ', data: updated }, null, 2) }]
      };
    }

    if (name === 'run_triage_pipeline') {
      const report = await runTriagePipeline();
      return {
        content: [{ type: 'text', text: JSON.stringify(report, null, 2) }]
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${error.message}` }]
    };
  }
});

// SSE Transport Instance for MCP
let sseTransport = null;

// Endpoint to initiate SSE connection
app.get('/sse', async (req, res) => {
  console.log('Client requested SSE connection for MCP');
  sseTransport = new SSEServerTransport('/messages', res);
  await mcpServer.connect(sseTransport);
  
  req.on('close', () => {
    console.log('SSE connection closed');
  });
});

// Endpoint to receive client messages
app.post('/messages', async (req, res) => {
  if (sseTransport) {
    await sseTransport.handleMessage(req, res);
  } else {
    res.status(400).json({ error: 'SSE connection not established' });
  }
});

// REST API: Health Check
app.get('/health', async (req, res) => {
  const status = {
    server: 'running',
    port: PORT,
    supabase: 'disconnected',
    ollama: 'disconnected'
  };

  try {
    const { error } = await supabase.from('chats').select('count', { count: 'exact', head: true });
    if (!error) status.supabase = 'connected';
  } catch (error) {
    status.supabase = `error: ${error.message}`;
  }

  try {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    const response = await fetch(`${ollamaUrl}/api/tags`);
    if (response.ok) {
      status.ollama = 'connected';
    }
  } catch (error) {
    status.ollama = `error: ${error.message}`;
  }

  res.json(status);
});

// REST API: AI Interactive Agent Chat (Process Thai questions/commands) - Protected
app.post('/api/agent/chat', authCompanyOrAdmin, async (req, res) => {
  const { query, company_id } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Missing parameter: query is required.' });
  }
  // Enforce company boundary: non-admins cannot query other companies
  const targetCompanyId = req.isAdmin ? (company_id || req.company?.id) : req.company?.id;
  try {
    const response = await processAgentQuery(query, targetCompanyId);
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REST API: Telegram Bot Webhook Endpoint (Secured & Consolidated)
app.post('/api/telegram/webhook', async (req, res) => {
  // Webhook Secret Token Verification if TELEGRAM_WEBHOOK_SECRET is configured
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const headerToken = req.headers['x-telegram-bot-api-secret-token'];
    if (headerToken !== webhookSecret) {
      console.warn('🔒 [Security Alert] Unauthorized Telegram Webhook call rejected: invalid secret token.');
      return res.status(403).json({ error: 'Forbidden: Invalid webhook secret token.' });
    }
  }

  res.status(200).send('OK'); // Acknowledge Telegram Webhook instantly to prevent timeouts

  const update = req.body;
  if (!update || typeof update !== 'object') return;

  try {
    if (update.message) {
      handleTelegramMessage(update.message).catch(err => {
        console.error('Error in Telegram Webhook Message Handler:', err.message);
      });
    } else if (update.callback_query) {
      handleTelegramCallbackQuery(update.callback_query).catch(err => {
        console.error('Error in Telegram Callback Query Handler:', err.message);
      });
    }
  } catch (err) {
    console.error('Error dispatching Telegram webhook:', err.message);
  }
});

// REST API: Live Priority Queue Status & Monitor (For Dashboard & QA Testers)
app.get('/api/queue/status', (req, res) => {
  res.json(getQueueMetrics());
});

// REST API: Get pending chats for authenticated company
app.get('/api/chats/pending', authCompany, async (req, res) => {
  try {
    const chats = await getPendingChats(req.company.id);
    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REST API: Trigger batch triage for authenticated company
app.post('/api/triage/run', authCompany, enforceCompanyQuota, async (req, res) => {
  try {
    const report = await runTriagePipeline(req.company.id);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REST API: Save triage result manually - Protected
app.post('/api/triage/save', authCompanyOrAdmin, async (req, res) => {
  const { id, category_id, priority, summary } = req.body;
  if (!id || !category_id || !priority || !summary) {
    return res.status(400).json({ error: 'Missing parameters: id, category_id, priority, summary' });
  }
  try {
    // Enforce company boundary and resolve the category within the chat's company
    const { data: chatRec, error: chatLookupErr } = await supabase.from('chats').select('company_id').eq('id', id).maybeSingle();
    if (chatLookupErr) throw chatLookupErr;
    if (!chatRec) {
      return res.status(404).json({ error: `Chat ${id} not found.` });
    }
    if (!req.isAdmin && chatRec.company_id !== req.company?.id) {
      return res.status(403).json({ error: 'Forbidden: Cannot save triage result on another company\'s chat.' });
    }
    const resolvedCategoryId = await resolveCompanyCategoryId(category_id, chatRec.company_id);
    if (!resolvedCategoryId) {
      return res.status(400).json({ error: `Unknown category_id for this chat's company: ${category_id}` });
    }

    const embedding = await getEmbedding(summary);
    const updated = await updateTriageResult(id, { category_id: resolvedCategoryId, priority, summary, embedding });
    res.json({ message: 'Success', data: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REST API: Ingest a new chat session from live chat (Real-time Seam) - Authenticated
app.post('/api/chats/ingest', authCompany, enforceCompanyQuota, async (req, res) => {
  const { id, customer_id, conversation } = req.body;
  if (!id || !customer_id || !conversation) {
    return res.status(400).json({ error: 'Missing parameters: id, customer_id, conversation' });
  }
  try {
    // Standardize conversation into a single string if it is a JSON array
    let finalConversation = conversation;
    if (Array.isArray(conversation)) {
      finalConversation = conversation.join('\n');
    }

    // 0. Ensure customer_id exists in 'customers' table to prevent foreign key constraint error!
    if (customer_id) {
      const { data: custCheck } = await supabase.from('customers').select('id').eq('id', customer_id).maybeSingle();
      if (!custCheck) {
        await supabase.from('customers').insert({
          id: customer_id,
          name: `Guest Customer (${customer_id})`,
          phone: null,
          email: null,
          company_id: req.company.id
        });
      }
    }

    // 1. Save chat session as pending, enforcing company boundary
    // (chat id is a global primary key, so another company's chat must never be overwritten)
    const chatRecord = {
      customer_id,
      conversation: finalConversation,
      status: 'pending'
    };
    const conflictResponse = () => res.status(409).json({
      error: `Conflict: Chat ID ${id} is already used by another company. Please use a different chat ID.`
    });

    const { data: existingChat, error: lookupErr } = await supabase
      .from('chats')
      .select('company_id, conversation')
      .eq('id', id)
      .maybeSingle();
    if (lookupErr) throw lookupErr;

    let data, error;
    if (existingChat) {
      if (existingChat.company_id !== req.company.id) {
        return conflictResponse();
      }
      // A changed conversation invalidates earlier human verification, so the AI may re-classify it
      if (existingChat.conversation !== finalConversation) {
        await supabase.from('chat_issues').update({ is_human_verified: false }).eq('chat_id', id);
      }
      ({ data, error } = await supabase
        .from('chats')
        .update(chatRecord)
        .eq('id', id)
        .eq('company_id', req.company.id)
        .select()
        .single());
    } else {
      ({ data, error } = await supabase
        .from('chats')
        .insert({ id, ...chatRecord, company_id: req.company.id })
        .select()
        .single());
      // Another request inserted the same id between lookup and insert
      if (error?.code === '23505') {
        return conflictResponse();
      }
    }

    if (error) throw error;
    
    // 2. Enqueue the triage in the background to process sequentially!
    enqueueTriage(id);

    res.json({ message: 'Chat ingested successfully and queued for real-time Sift AI classification', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REST API: Trigger on-demand Sift AI classification for a single chat (Dynamic Real-time Triage) - Protected
app.post('/api/chats/:id/triage', authCompanyOrAdmin, async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Missing parameter: id is required' });
  }
  try {
    // Check if chat exists and enforce company boundary
    const { data: chatRec } = await supabase.from('chats').select('company_id').eq('id', id).maybeSingle();
    if (!chatRec) {
      return res.status(404).json({ error: `Chat ${id} not found.` });
    }

    if (chatRec.company_id && !req.isAdmin && req.company?.id && chatRec.company_id !== req.company.id) {
      return res.status(403).json({ error: 'Forbidden: Cannot trigger triage on another company\'s chat.' });
    }

    // Check if chat's company has exceeded quota before triggering
    if (chatRec.company_id) {
      const quota = await checkCompanyQuota(chatRec.company_id);
      if (quota.isExceeded) {
        return res.status(429).json({
          error: 'โควต้าการใช้งานต่อเดือนครบแล้ว (Monthly Chat Quota Exceeded)',
          message: `บริษัท ${quota.companyName} ใช้โควต้าแชตครบกำหนดของแพ็กเกจ ${quota.packageName} (${quota.monthlyLimit?.toLocaleString()} แชต) แล้วในรอบนี้`,
          quota
        });
      }
    }

    console.log(`[API] Triggering on-demand triage for chat: ${id}...`);
    await processSingleChat(id);

    // Fetch updated chat and relational issues
    const { data: updatedChat, error: chatErr } = await supabase
      .from('chats')
      .select('*, chat_issues(*)')
      .eq('id', id)
      .single();

    if (chatErr) throw chatErr;

    res.json({
      message: `Chat ${id} triaged successfully by AI (Qwen 2.5 + BGE-M3)`,
      chat: updatedChat,
      issues: updatedChat.chat_issues || []
    });
  } catch (error) {
    console.error(`[API] On-demand triage failed for ${id}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// REST API: Submit human audit/override feedback (Human-in-the-Loop Seam) - Authenticated
app.post('/api/chats/feedback', authCompany, async (req, res) => {
  const { chat_id, is_correct, corrected_category_id, liked_by, issues } = req.body;
  if (!chat_id || is_correct === undefined) {
    return res.status(400).json({ error: 'Missing parameters: chat_id, is_correct' });
  }

  try {
    // 0. Enforce company boundary: chat (and any issues overridden) must belong to the authenticated company
    const { data: chatRec, error: chatLookupErr } = await supabase
      .from('chats')
      .select('company_id')
      .eq('id', chat_id)
      .maybeSingle();
    if (chatLookupErr) throw chatLookupErr;
    if (!chatRec) {
      return res.status(404).json({ error: `Chat ${chat_id} not found.` });
    }
    if (chatRec.company_id !== req.company.id) {
      return res.status(403).json({ error: 'Forbidden: Cannot submit feedback on another company\'s chat.' });
    }

    if (issues && issues.length > 0) {
      const issueIds = issues.map(issue => issue.id);
      const { data: ownedIssues, error: issueLookupErr } = await supabase
        .from('chat_issues')
        .select('id')
        .eq('chat_id', chat_id)
        .in('id', issueIds);
      if (issueLookupErr) throw issueLookupErr;
      if (issueIds.some(issueId => !ownedIssues.some(owned => String(owned.id) === String(issueId)))) {
        return res.status(400).json({ error: 'Invalid issues: every issue id must belong to the given chat_id.' });
      }
    }

    // Resolve caller-supplied category IDs to the company's own category IDs
    let correctedCategoryId = null;
    if (corrected_category_id) {
      correctedCategoryId = await resolveCompanyCategoryId(corrected_category_id, req.company.id);
      if (!correctedCategoryId) {
        return res.status(400).json({ error: `Unknown corrected_category_id: ${corrected_category_id}` });
      }
    }
    const resolvedIssues = [];
    for (const issue of (issues || [])) {
      const resolvedId = issue.category_id ? await resolveCompanyCategoryId(issue.category_id, req.company.id) : null;
      if (issue.category_id && !resolvedId) {
        return res.status(400).json({ error: `Unknown category_id in issues: ${issue.category_id}` });
      }
      resolvedIssues.push({ ...issue, category_id: resolvedId || undefined });
    }
    let finalCategoryId = correctedCategoryId;
    let finalPriority = null;

    // 1. Handle multi-issue overrides if provided
    if (resolvedIssues.length > 0) {
      await updateChatIssues(resolvedIssues);

      // Determine highest priority issue to sync with the primary chats table
      const priorityWeight = { urgent: 4, high: 3, medium: 2, low: 1 };
      let highestIssue = resolvedIssues[0];
      let maxWeight = priorityWeight[highestIssue.priority?.toLowerCase()] || 0;

      for (const issue of resolvedIssues) {
        const weight = priorityWeight[issue.priority?.toLowerCase()] || 0;
        if (weight > maxWeight) {
          maxWeight = weight;
          highestIssue = issue;
        }
      }

      finalCategoryId = highestIssue.category_id || finalCategoryId;
      finalPriority = highestIssue.priority;
    }

    // 2. Handle main chats table update
    const updateData = { resolution: 'Solved' };
    if (!is_correct && finalCategoryId) {
      updateData.category_id = finalCategoryId;
    }
    if (finalPriority) {
      updateData.priority = finalPriority;
    }

    await supabase
      .from('chats')
      .update(updateData)
      .eq('id', chat_id)
      .eq('company_id', req.company.id);

    // 2. Log audit task and audit result in Supabase (attributed to the authenticated company)
    const companyId = req.company.id;

    const { data: auditTask, error: taskErr } = await supabase
      .from('audit_tasks')
      .insert({
        company_id: companyId,
        status: 'completed',
        started_by: liked_by || null,
        summary: 'ผู้ใช้งานทำการกดยืนยัน/แก้ไขผลลัพธ์ผ่านหน้าจอ BO'
      })
      .select()
      .single();

    if (taskErr) throw taskErr;

    if (auditTask) {
      const { error: resErr } = await supabase
        .from('audit_results')
        .insert({
          task_id: auditTask.id,
          chat_id,
          category_id: correctedCategoryId,
          is_correct,
          summary: is_correct ? 'AI คัดแยกถูกต้อง' : 'ปรับเปลี่ยนหมวดหมู่โดยแอดมิน'
        });

      if (resErr) throw resErr;
    }

    res.json({ message: 'Feedback logged successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// REST API: Isolated Category CRUD Endpoints
// ==========================================

// GET all categories for the authenticated company
app.get('/api/categories', authCompany, async (req, res) => {
  try {
    const categories = await getCategories(req.company.id);
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create a new category (isolated to the company)
app.post('/api/categories', authCompany, async (req, res) => {
  const { id, name, name_en, description } = req.body;
  if (!id || !name || !description) {
    return res.status(400).json({ error: 'Missing parameters: id, name, description' });
  }
  try {
    // Generate vector embedding for description
    const embedding = await getEmbedding(description);
    
    // Prefix ID with company_id to keep it globally unique
    const uniqueId = `${req.company.id}:${id}`;

    const insertPayload = {
      id: uniqueId,
      name,
      description,
      embedding,
      company_id: req.company.id
    };
    if (name_en) {
      insertPayload.name_en = name_en;
    }

    const { data, error } = await supabase
      .from('categories')
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw error;
    res.json({ message: 'Category created successfully', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update an existing category
app.put('/api/categories/:id', authCompany, async (req, res) => {
  const { id } = req.params;
  const { name, name_en, description } = req.body;
  
  if (!name || !description) {
    return res.status(400).json({ error: 'Missing parameters: name, description' });
  }

  try {
    // 1. Verify ownership of the category
    const { data: existing, error: findErr } = await supabase
      .from('categories')
      .select('id, description')
      .eq('id', id)
      .eq('company_id', req.company.id)
      .maybeSingle();

    if (findErr || !existing) {
      return res.status(404).json({ error: 'Category not found or unauthorized' });
    }

    // 2. Recalculate embedding if description has changed
    let embedding = null;
    if (existing.description !== description) {
      embedding = await getEmbedding(description);
    }

    // 3. Update the category
    const updateData = { name, description };
    if (name_en !== undefined) {
      updateData.name_en = name_en;
    }
    if (embedding) {
      updateData.embedding = embedding;
    }

    const { data, error } = await supabase
      .from('categories')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', req.company.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ message: 'Category updated successfully', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE a category
app.delete('/api/categories/:id', authCompany, async (req, res) => {
  const { id } = req.params;
  try {
    // Verify ownership and delete
    const { data, error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id)
      .eq('company_id', req.company.id)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Category not found or unauthorized' });
    }
    res.json({ message: 'Category deleted successfully', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// REST API: Company Registration Endpoint
// ==========================================

// Register a new company/tenant (Unauthenticated Seam)
app.post('/api/companies/register', async (req, res) => {
  const { name, domain } = req.body;
  if (!name || !domain) {
    return res.status(400).json({ error: 'Missing parameters: name, domain' });
  }

  try {
    // 1. Insert the new company
    const { data: newCompany, error: compErr } = await supabase
      .from('companies')
      .insert({ name, domain })
      .select()
      .single();

    if (compErr) throw compErr;

    // 2. Copy the default categories to the new company (Copy-on-Registration)
    console.log(`Cloning default categories for new company: ${name} (ID: ${newCompany.id})...`);
    await initializeCompanyCategories(newCompany.id);

    res.json({
      message: 'Company registered successfully and default categories initialized',
      company: {
        id: newCompany.id,
        name: newCompany.name,
        domain: newCompany.domain,
        client_id: newCompany.client_id,
        client_secret: newCompany.client_secret
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// REST API: Subscription Packages & Quotas
// ==========================================

// Get all subscription packages & pricing specs (Partner & Standard)
app.get('/api/packages', (req, res) => {
  res.json({
    message: 'Sift AI Subscription Packages',
    packages: PACKAGE_CONFIG
  });
});

// Get all companies with real-time quota and package details (Sanitized, NO client_secret)
app.get('/api/companies', async (req, res) => {
  try {
    const companies = await getAllCompanies(false);
    const withQuotas = await Promise.all(companies.map(async (c) => {
      try {
        const quota = await checkCompanyQuota(c.id);
        return {
          id: c.id,
          name: c.name,
          domain: c.domain,
          customer_type: c.customer_type,
          package_tier: c.package_tier,
          custom_quota: c.custom_quota,
          package_status: c.package_status,
          telegram_group_limit: c.telegram_group_limit,
          billing_cycle_anchor: c.billing_cycle_anchor,
          created_at: c.created_at,
          quota
        };
      } catch (e) {
        return {
          id: c.id,
          name: c.name,
          domain: c.domain,
          customer_type: c.customer_type,
          package_tier: c.package_tier,
          custom_quota: c.custom_quota,
          package_status: c.package_status,
          telegram_group_limit: c.telegram_group_limit,
          billing_cycle_anchor: c.billing_cycle_anchor,
          created_at: c.created_at,
          quota: null
        };
      }
    }));
    res.json(withQuotas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current authenticated company quota and usage
app.get('/api/quota/status', authCompany, async (req, res) => {
  try {
    const quota = await checkCompanyQuota(req.company.id);
    res.json(quota);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get quota for specific company (Protected: Admin or own company)
app.get('/api/companies/:id/quota', authCompanyOrAdmin, async (req, res) => {
  if (!req.isAdmin && req.company?.id && req.company.id !== req.params.id) {
    return res.status(403).json({ error: 'Forbidden: Cannot view another company\'s quota.' });
  }
  try {
    const quota = await checkCompanyQuota(req.params.id);
    res.json(quota);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update company package & quota settings (Admin only - Protected with X-Admin-Key or Admin session)
app.put('/api/companies/:id/package', authAdminOrKey, async (req, res) => {
  const { id } = req.params;
  const { customer_type, package_tier, custom_quota, package_status, billing_cycle_anchor, telegram_group_limit } = req.body;
  
  if (customer_type && !['partner', 'standard'].includes(customer_type)) {
    return res.status(400).json({ error: 'Invalid customer_type. Must be "partner" or "standard"' });
  }
  if (package_tier && !['starter', 'pro', 'enterprise', 'custom'].includes(package_tier)) {
    return res.status(400).json({ error: 'Invalid package_tier. Must be "starter", "pro", "enterprise", or "custom"' });
  }

  try {
    const updated = await updateCompanyPackage(id, {
      customer_type,
      package_tier,
      custom_quota,
      package_status,
      billing_cycle_anchor,
      telegram_group_limit
    });

    const quota = await checkCompanyQuota(id);
    res.json({
      message: 'Company package updated successfully',
      company: updated,
      quota
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// REST API: Optimized Analytics Stats Endpoints
// ==========================================

// 1. GET overview counters (total, pending, urgent, customer counts)
app.get('/api/stats/counters', authCompany, async (req, res) => {
  try {
    // Select ONLY light metadata columns, avoiding conversation and embedding
    const { data: chats, error } = await supabase
      .from('chats')
      .select('status, priority, customer_id')
      .eq('company_id', req.company.id);

    if (error) throw error;

    const total = chats.length;
    const pending = chats.filter(c => c.status === 'pending').length;
    const urgent = chats.filter(c => c.priority === 'high' || c.priority === 'urgent').length;
    
    // Unique customer count
    const uniqueCustomers = new Set(chats.map(c => c.customer_id).filter(Boolean));

    res.json({
      total_chats: total,
      pending_chats: pending,
      urgent_chats: urgent,
      customer_count: uniqueCustomers.size
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. GET categories case counts
app.get('/api/stats/categories', authCompany, async (req, res) => {
  try {
    // Get all categories for this company
    const categories = await getCategories(req.company.id);
    
    // Get chat count by category, selecting ONLY category_id
    const { data: chats, error } = await supabase
      .from('chats')
      .select('category_id')
      .eq('company_id', req.company.id);

    if (error) throw error;

    const stats = categories.map(cat => {
      const count = chats.filter(c => c.category_id === cat.id).length;
      return {
        id: cat.id,
        name: cat.name,
        name_th: cat.name_th || cat.name,
        name_en: cat.name_en,
        count
      };
    });

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. GET priority distribution
app.get('/api/stats/priorities', authCompany, async (req, res) => {
  try {
    // Get chats selecting ONLY priority
    const { data: chats, error } = await supabase
      .from('chats')
      .select('priority')
      .eq('company_id', req.company.id);

    if (error) throw error;

    const priorities = ['low', 'medium', 'high', 'urgent'];
    const stats = {};
    priorities.forEach(p => {
      stats[p] = chats.filter(c => c.priority === p).length;
    });

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. GET AI accuracy stats
app.get('/api/stats/accuracy', authCompany, async (req, res) => {
  try {
    // Fetch audit results linked to this company's chats
    const { data: auditResults, error } = await supabase
      .from('audit_results')
      .select('is_correct, chats!inner(company_id)')
      .eq('chats.company_id', req.company.id);

    if (error) throw error;

    const auditedCount = auditResults.length;
    const correctCount = auditResults.filter(r => r.is_correct).length;
    const overrideCount = auditedCount - correctCount;
    const accuracyRate = auditedCount > 0 ? (correctCount / auditedCount) * 100 : 100;

    res.json({
      accuracy_rate: parseFloat(accuracyRate.toFixed(1)),
      audited_cases: auditedCount,
      confirmed_by_ai: correctCount,
      overridden_by_admin: overrideCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// REST API: Authentication & User Management (RBAC)
// ==========================================

// Middleware: Authenticate user via email/password headers
async function authUser(req, res, next) {
  const email = req.headers['x-user-email'];
  const password = req.headers['x-user-password'];

  if (!email || !password) {
    return res.status(401).json({ error: 'Unauthorized: Missing email or password in headers (x-user-email / x-user-password).' });
  }

  try {
    const user = await authenticateUser(email, password);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid email or password.' });
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Authentication error: ' + err.message });
  }
}

// Middleware: Require minimum role level
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const userRoleLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const hasPermission = allowedRoles.some(role => userRoleLevel >= ROLE_HIERARCHY[role]);

    if (!hasPermission) {
      return res.status(403).json({
        error: `Forbidden: ต้องมีสิทธิ์ระดับ ${allowedRoles.join(' หรือ ')} ขึ้นไป (สิทธิ์ปัจจุบัน: ${req.user.role})`
      });
    }
    next();
  };
}

// POST /api/auth/login - Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'กรุณาระบุ email และ password' });
    }

    const user = await authenticateUser(email, password);
    if (!user) {
      return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        company_id: user.company_id,
        permissions: user.permissions,
        company: user.company
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users - List users (super_admin: own company, system_admin: all)
app.get('/api/users', authUser, requireRole('super_admin'), async (req, res) => {
  try {
    const companyId = req.user.role === 'system_admin' ? req.query.company_id : req.user.company_id;
    const users = await getAllUsers(companyId || undefined);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/users - Create user (super_admin: own company, system_admin: any)
app.post('/api/users', authUser, requireRole('super_admin'), async (req, res) => {
  try {
    const { email, name, role, company_id, password, permissions } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'กรุณาระบุ email และ name' });
    }

    // Prevent non-system_admin from creating higher-level roles
    const creatorLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const targetLevel = ROLE_HIERARCHY[role] || 0;
    if (targetLevel >= creatorLevel) {
      return res.status(403).json({ error: 'ไม่สามารถสร้างผู้ใช้ที่มีสิทธิ์เท่ากับหรือสูงกว่าตนเองได้' });
    }

    // Non-system_admin can only create users in their own company
    const targetCompanyId = req.user.role === 'system_admin' ? (company_id || req.user.company_id) : req.user.company_id;

    const newUser = await createUser({
      email,
      name,
      role: role || 'agent',
      company_id: targetCompanyId,
      password: password || '123456',
      permissions
    });

    res.status(201).json({ message: 'สร้างผู้ใช้สำเร็จ', user: newUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/users/:id - Update user
app.put('/api/users/:id', authUser, requireRole('super_admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent editing yourself
    if (id === req.user.id) {
      return res.status(403).json({ error: 'ไม่สามารถแก้ไขสิทธิ์ตนเองได้' });
    }

    // Prevent assigning role >= own level
    if (req.body.role) {
      const creatorLevel = ROLE_HIERARCHY[req.user.role] || 0;
      const targetLevel = ROLE_HIERARCHY[req.body.role] || 0;
      if (targetLevel >= creatorLevel) {
        return res.status(403).json({ error: 'ไม่สามารถกำหนดสิทธิ์เท่ากับหรือสูงกว่าตนเองได้' });
      }
    }

    const updated = await updateUser(id, req.body);
    res.json({ message: 'อัปเดตผู้ใช้สำเร็จ', user: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/users/:id - Delete user
app.delete('/api/users/:id', authUser, requireRole('super_admin'), async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.user.id) {
      return res.status(403).json({ error: 'ไม่สามารถลบตนเองได้' });
    }

    const deleted = await deleteUser(id);
    res.json({ message: 'ลบผู้ใช้สำเร็จ', user: deleted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/companies - List all companies with full details (system_admin only)
app.get('/api/admin/companies', authUser, requireRole('system_admin'), async (req, res) => {
  try {
    const companies = await getAllCompanies(true);
    res.json(companies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// CUSTOMER MANAGEMENT REST API ENDPOINTS (Protected)
// ==========================================

// GET /api/customers - List all customer members (Protected: own company only)
app.get('/api/customers', authCompanyOrAdmin, async (req, res) => {
  try {
    const targetCompanyId = req.isAdmin ? (req.query.company_id || undefined) : req.company?.id;
    const customers = await getAllCustomers(targetCompanyId);
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/customers - Create a new customer member (Protected: own company only)
app.post('/api/customers', authCompanyOrAdmin, async (req, res) => {
  try {
    const { id, name, email, phone, company_id } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'กรุณาระบุชื่อลูกค้า (name)' });
    }

    const targetCompanyId = req.isAdmin ? (company_id || req.company?.id) : req.company?.id;

    const newCustomer = await createCustomer({
      id,
      name,
      email,
      phone,
      company_id: targetCompanyId
    });

    res.status(201).json({
      message: 'เพิ่มสมาชิกลูกค้าใหม่สำเร็จ (Customer created successfully)',
      customer: newCustomer
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/customers/:id - Update an existing customer (Protected: own company only)
app.put('/api/customers/:id', authCompanyOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership if not admin
    if (!req.isAdmin && req.company?.id) {
      const { data: existing } = await supabase.from('customers').select('company_id').eq('id', id).maybeSingle();
      if (existing && existing.company_id && existing.company_id !== req.company.id) {
        return res.status(403).json({ error: 'Forbidden: Cannot edit another company\'s customer.' });
      }
    }

    const updated = await updateCustomer(id, req.body);
    res.json({ message: 'อัปเดตข้อมูลลูกค้าสำเร็จ', customer: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/customers/:id - Delete a customer (Protected: own company only)
app.delete('/api/customers/:id', authCompanyOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership if not admin
    if (!req.isAdmin && req.company?.id) {
      const { data: existing } = await supabase.from('customers').select('company_id').eq('id', id).maybeSingle();
      if (existing && existing.company_id && existing.company_id !== req.company.id) {
        return res.status(403).json({ error: 'Forbidden: Cannot delete another company\'s customer.' });
      }
    }

    const deleted = await deleteCustomer(id);
    res.json({ message: 'ลบข้อมูลลูกค้าสำเร็จ', customer: deleted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  Sift AI MCP Server & API is running on port ${PORT}`);
  console.log(`  MCP SSE Endpoint: http://localhost:${PORT}/sse`);
  console.log(`  Health Check:     http://localhost:${PORT}/health`);
  console.log(`==================================================`);
  initTelegramBot();
});
