import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { supabase, getPendingChats, updateTriageResult, updateChatIssues, authenticateCompany, initializeCompanyCategories, getCategories, authenticateUser, getAllUsers, createUser, updateUser, deleteUser, getAllCompanies, getAllCustomers, createCustomer, updateCustomer, deleteCustomer, ROLE_HIERARCHY } from './supabase.js';
import { getEmbedding } from './ollama.js';
import { runTriagePipeline, processSingleChat } from './triageService.js';
import { extractTextFromImage } from './ocr.js';
import { processAgentQuery } from './agentService.js';
import { handleTelegramMessage, handleTelegramCallbackQuery, startTelegramPolling, initTelegramBot, setTelegramWebhook } from './telegramBot.js';

dotenv.config();

// Simple background triage queue to process requests sequentially and avoid overloading CPU/Ollama
const triageQueue = [];
let isQueueProcessing = false;

function enqueueTriage(chatId) {
  // Avoid duplicate entries in queue
  if (!triageQueue.includes(chatId)) {
    triageQueue.push(chatId);
  }
  // Safeguard: Ensure chat is marked 'pending' in database while waiting in queue
  supabase.from('chats').update({ status: 'pending' }).eq('id', chatId).then();
  processTriageQueue();
}

async function processTriageQueue() {
  if (isQueueProcessing || triageQueue.length === 0) return;
  isQueueProcessing = true;

  const nextChatId = triageQueue.shift();
  console.log(`[Queue] Starting background triage for chat ${nextChatId} (Remaining in queue: ${triageQueue.length})`);
  try {
    await processSingleChat(nextChatId);
  } catch (err) {
    console.error(`[Queue] Background triage failed for ${nextChatId}:`, err.message);
  } finally {
    isQueueProcessing = false;
    processTriageQueue();
  }
}

// Auto-enqueue any un-triaged or incomplete chats from database on startup
(async () => {
  try {
    const { data: orphaned } = await supabase
      .from('chats')
      .select('id')
      .or('status.eq.pending,category_id.is.null,embedding.is.null');

    // Also check recent chats that have 0 issues in chat_issues
    const { data: allRecent } = await supabase
      .from('chats')
      .select('id, chat_issues(id)')
      .order('created_at', { ascending: false })
      .limit(100);

    const missingIssues = (allRecent || []).filter(c => !c.chat_issues || c.chat_issues.length === 0);
    const toEnqueue = new Set([
      ...(orphaned || []).map(c => c.id),
      ...missingIssues.map(c => c.id)
    ]);

    if (toEnqueue.size > 0) {
      console.log(`[Queue] Found ${toEnqueue.size} un-triaged or incomplete chats in database on startup. Auto-enqueueing...`);
      // Safeguard: Ensure un-triaged chats show as 'pending' so admins know they are awaiting AI triage
      await supabase
        .from('chats')
        .update({ status: 'pending' })
        .in('id', Array.from(toEnqueue));

      toEnqueue.forEach(id => enqueueTriage(id));
    }
  } catch (err) {
    console.error('Failed to auto-enqueue un-triaged chats on startup:', err.message);
  }
})();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// Setup MCP Server instance
const mcpServer = new Server(
  {
    name: 'ai-triage-mcp-server',
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
      const embedding = await getEmbedding(summary);
      const updated = await updateTriageResult(id, {
        category_id,
        priority,
        summary,
        embedding
      });
      if (detected_issues && Array.isArray(detected_issues) && detected_issues.length > 0) {
        await saveChatIssues(id, detected_issues);
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

// REST API: AI Interactive Agent Chat (Process Thai questions/commands)
app.post('/api/agent/chat', async (req, res) => {
  const { query, company_id } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Missing parameter: query is required.' });
  }
  try {
    const response = await processAgentQuery(query, company_id);
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REST API: Telegram Bot Webhook Endpoint
app.post('/api/telegram/webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update && update.message) {
      handleTelegramMessage(update.message).catch(err => console.error('Telegram Webhook error:', err));
    }
    res.status(200).send('OK');
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
app.post('/api/triage/run', authCompany, async (req, res) => {
  try {
    const report = await runTriagePipeline(req.company.id);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REST API: Save triage result manually
app.post('/api/triage/save', async (req, res) => {
  const { id, category_id, priority, summary } = req.body;
  if (!id || !category_id || !priority || !summary) {
    return res.status(400).json({ error: 'Missing parameters: id, category_id, priority, summary' });
  }
  try {
    const embedding = await getEmbedding(summary);
    const updated = await updateTriageResult(id, { category_id, priority, summary, embedding });
    res.json({ message: 'Success', data: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REST API: Ingest a new chat session from live chat (Real-time Seam) - Authenticated
app.post('/api/chats/ingest', authCompany, async (req, res) => {
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
      const { data: custCheck } = await supabase.from('customers').select('id').eq('id', customer_id).single();
      if (!custCheck) {
        await supabase.from('customers').insert({
          id: customer_id,
          name: `Guest Customer (${customer_id})`,
          phone: null,
          email: null
        });
      }
    }

    // 1. Upsert chat session as pending, referencing the authenticated company
    const { data, error } = await supabase
      .from('chats')
      .upsert({ 
        id, 
        customer_id, 
        conversation: finalConversation, 
        status: 'pending',
        company_id: req.company.id
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // 2. Enqueue the triage in the background to process sequentially!
    enqueueTriage(id);

    res.json({ message: 'Chat ingested successfully and queued for real-time AI Triage', data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REST API: Trigger on-demand AI Triage for a single chat (Dynamic Real-time Triage)
app.post('/api/chats/:id/triage', async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Missing parameter: id is required' });
  }
  try {
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
  const { chat_id, is_correct, corrected_category_id, liked_by, comment, is_like, issues } = req.body;
  if (!chat_id || is_correct === undefined) {
    return res.status(400).json({ error: 'Missing parameters: chat_id, is_correct' });
  }

  try {
    let finalCategoryId = corrected_category_id;
    let finalPriority = null;

    // 1. Handle multi-issue overrides if provided
    if (issues && issues.length > 0) {
      await updateChatIssues(issues);

      // Determine highest priority issue to sync with the primary chats table
      const priorityWeight = { urgent: 4, high: 3, medium: 2, low: 1 };
      let highestIssue = issues[0];
      let maxWeight = priorityWeight[highestIssue.priority?.toLowerCase()] || 0;

      for (const issue of issues) {
        const weight = priorityWeight[issue.priority?.toLowerCase()] || 0;
        if (weight > maxWeight) {
          maxWeight = weight;
          highestIssue = issue;
        }
      }

      finalCategoryId = highestIssue.category_id;
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
      .eq('id', chat_id);

    // 2. Log audit task and audit result in Supabase
    const { data: userRecord } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', liked_by || '')
      .maybeSingle();
      
    const companyId = userRecord?.company_id || null;

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
      const { data: auditResult, error: resErr } = await supabase
        .from('audit_results')
        .insert({
          task_id: auditTask.id,
          chat_id,
          category_id: corrected_category_id || null,
          is_correct,
          summary: is_correct ? 'AI คัดแยกถูกต้อง' : 'ปรับเปลี่ยนหมวดหมู่โดยแอดมิน'
        })
        .select()
        .single();

      if (resErr) throw resErr;

      // 3. Log user like/dislike feedback
      if (auditResult && is_like !== undefined) {
        const { error: likeErr } = await supabase
          .from('like_results')
          .insert({
            result_id: auditResult.id,
            liked_by: liked_by || null,
            is_like,
            comment: comment || ''
          });
        
        if (likeErr) throw likeErr;
      }
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

// GET /api/companies - List all companies (system_admin only)
app.get('/api/companies', authUser, requireRole('system_admin'), async (req, res) => {
  try {
    const companies = await getAllCompanies();
    res.json(companies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// CUSTOMER MANAGEMENT REST API ENDPOINTS
// ==========================================

// GET /api/customers - List all customer members
app.get('/api/customers', async (req, res) => {
  try {
    const companyId = req.query.company_id || undefined;
    const customers = await getAllCustomers(companyId);
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/customers - Create a new customer member (for Postman testing & UI)
app.post('/api/customers', async (req, res) => {
  try {
    const { id, name, email, phone, company_id } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'กรุณาระบุชื่อลูกค้า (name)' });
    }

    const newCustomer = await createCustomer({
      id,
      name,
      email,
      phone,
      company_id
    });

    res.status(201).json({
      message: 'เพิ่มสมาชิกลูกค้าใหม่สำเร็จ (Customer created successfully)',
      customer: newCustomer
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/customers/:id - Update an existing customer
app.put('/api/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await updateCustomer(id, req.body);
    res.json({ message: 'อัปเดตข้อมูลลูกค้าสำเร็จ', customer: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/customers/:id - Delete a customer
app.delete('/api/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await deleteCustomer(id);
    res.json({ message: 'ลบข้อมูลลูกค้าสำเร็จ', customer: deleted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/telegram/webhook - Telegram Webhook Receiver Endpoint
app.post('/api/telegram/webhook', (req, res) => {
  res.status(200).send('OK'); // Acknowledge Telegram Webhook instantly to prevent timeouts
  const update = req.body;
  console.log('📥 Telegram Webhook Payload Received:', JSON.stringify(update));
  if (update) {
    if (update.message) {
      handleTelegramMessage(update.message).catch(err => {
        console.error('Error in Telegram Webhook Handler:', err.message);
      });
    } else if (update.callback_query) {
      handleTelegramCallbackQuery(update.callback_query).catch(err => {
        console.error('Error in Telegram Callback Query Handler:', err.message);
      });
    }
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  AI Triage MCP Server & API is running on port ${PORT}`);
  console.log(`  MCP SSE Endpoint: http://localhost:${PORT}/sse`);
  console.log(`  Health Check:     http://localhost:${PORT}/health`);
  console.log(`==================================================`);
  initTelegramBot();
});
