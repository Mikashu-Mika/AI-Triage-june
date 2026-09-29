import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { CATEGORY_BILINGUAL_MAP } from './categoryConstants.js';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('Warning: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY is not defined in environment variables. Database integration will fail until configured.');
}

// Initialize Supabase Client using the Service Role Key or Anon Key
export const supabase = createClient(SUPABASE_URL || '', SUPABASE_KEY || '');

/**
 * Fetch categories for a specific company or global templates if companyId is not provided.
 * Enriches each category with clean bilingual properties:
 * - name: pure Thai
 * - name_th: pure Thai
 * - name_en: pure English Title Case
 * @param {string} [companyId] - The ID of the company.
 * @returns {Promise<any[]>}
 */
export async function getCategories(companyId) {
  let query = supabase.from('categories').select('*');
  if (companyId) {
    query = query.eq('company_id', companyId);
  }
  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch categories: ${error.message}`);
  }

  // Fallback: If company filtering returned 0 categories, fetch all categories
  let list = data;
  if ((!list || list.length === 0) && companyId) {
    const { data: allData } = await supabase.from('categories').select('*');
    list = allData || [];
  }
  list = list || [];

  return list.map(cat => {
    const rawKey = cat.id.includes(':') ? cat.id.split(':').slice(1).join(':') : cat.id;
    const mapping = CATEGORY_BILINGUAL_MAP[rawKey];

    // Pure Thai name (strip out any trailing parenthesis if present)
    let pureThai = cat.name ? cat.name.replace(/\s*\([^)]*\)\s*$/, '').trim() : '';
    if (!pureThai && mapping) pureThai = mapping.name_th;

    // English name: use DB cat.name_en if present, else fallback mapping, else parse from parentheses
    let enName = cat.name_en;
    if (!enName) {
      if (mapping) {
        enName = mapping.name_en;
      } else {
        const m = cat.name ? cat.name.match(/\(([^)]+)\)/) : null;
        enName = m ? m[1].trim() : rawKey;
      }
    }

    return {
      ...cat,
      name: pureThai,
      name_th: pureThai,
      name_en: enName
    };
  });
}

/**
 * Fetch all chats that are pending triage for a company, including nested customer information.
 * @param {string} [companyId] - The ID of the company.
 * @returns {Promise<any[]>}
 */
export async function getPendingChats(companyId) {
  let query = supabase
    .from('chats')
    .select('id, customer_id, conversation, status, company_id, customers(*)')
    .eq('status', 'pending');

  if (companyId) {
    query = query.eq('company_id', companyId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch pending chats: ${error.message}`);
  }

  return data || [];
}

/**
 * Update a chat session with triage analysis results.
 * @param {string} id - The ID of the chat.
 * @param {object} result - Triage results.
 */
export async function updateTriageResult(id, { 
  category_id, 
  priority, 
  summary, 
  embedding,
  sub_category,
  intent,
  root_cause,
  sentiment,
  urgency,
  department,
  keywords,
  confidence,
  recommended_reply,
  resolution,
  business_impact,
  business_impact_score,
  ai_recommendation
}) {
  const { data, error } = await supabase
    .from('chats')
    .update({
      category_id,
      priority,
      summary,
      embedding,
      sub_category,
      intent,
      root_cause,
      sentiment,
      urgency,
      department,
      keywords,
      confidence,
      recommended_reply,
      resolution,
      business_impact,
      business_impact_score,
      ai_recommendation,
      status: 'completed'
    })
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to update triage result for chat ${id}: ${error.message}`);
  }

  return { id, status: 'completed' };
}

/**
 * Query similar chats using pgvector similarity search via Supabase RPC.
 * @param {number[]} embedding - The vector embedding of the query.
 * @param {number} threshold - Match similarity threshold.
 * @param {number} limit - Maximum number of results.
 * @returns {Promise<any[]>}
 */
export async function findSimilarChats(embedding, threshold = 0.7, limit = 5) {
  const { data, error } = await supabase.rpc('match_chats', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: limit
  });

  if (error) {
    console.error('Error in match_chats RPC:', error.message);
    return [];
  }

  return data || [];
}

/**
 * Upsert a customer record (useful for seeding).
 * @param {object} customer
 */
export async function insertCustomer(customer) {
  const { data, error } = await supabase
    .from('customers')
    .upsert(customer)
    .select();

  if (error) {
    throw new Error(`Failed to insert customer ${customer.id}: ${error.message}`);
  }

  return data;
}

/**
 * Upsert a category record (useful for seeding).
 * @param {object} category
 */
export async function insertCategory(category) {
  const { data, error } = await supabase
    .from('categories')
    .upsert(category)
    .select();

  if (error) {
    throw new Error(`Failed to insert category ${category.id}: ${error.message}`);
  }

  return data;
}

/**
 * Insert a new chat session (mostly for testing and demo).
 * @param {object} chat
 */
export async function insertChat(chat) {
  const { data, error } = await supabase
    .from('chats')
    .insert([
      {
        id: chat.id,
        customer_id: chat.customer_id,
        conversation: chat.conversation,
        status: chat.status || 'pending',
        created_at: chat.created_at || new Date().toISOString(),
        company_id: chat.company_id
      }
    ])
    .select();

  if (error) {
    throw new Error(`Failed to insert chat ${chat.id}: ${error.message}`);
  }

  return data;
}

/**
 * Fetch all training examples for few-shot learning, filtered by company.
 * @param {string} [companyId] - The ID of the company.
 * @returns {Promise<any[]>}
 */
export async function getTrainingExamples(companyId) {
  let query = supabase.from('training_examples').select('*');
  if (companyId) {
    query = query.eq('company_id', companyId);
  }
  const { data, error } = await query
    .order('created_at', { ascending: false }) // Get newest first
    .limit(5); // Limit to 5 examples to speed up CPU prompt ingestion

  if (error) {
    throw new Error(`Failed to fetch training examples: ${error.message}`);
  }

  return data || [];
}

/**
 * Save multi-issue breakdown records to the new chat_issues table.
 * @param {string} chatId - The ID of the chat.
 * @param {any[]} issues - Array of issues detected by AI triage.
 */
export async function saveChatIssues(chatId, issues) {
  // Safeguard: Do NOT delete existing issues if no new issues to insert
  // This prevents data loss when the AI returns an empty detected_issues array
  if (!issues || issues.length === 0) {
    console.log(`⚠️ No issues to save for ${chatId}, keeping existing issues intact.`);
    return;
  }

  // 1. Delete existing issues for this chat to avoid duplicates
  const { error: delError } = await supabase
    .from('chat_issues')
    .delete()
    .eq('chat_id', chatId);

  if (delError) {
    throw new Error(`Failed to clear existing chat issues for ${chatId}: ${delError.message}`);
  }

  // 2. Insert new issues
  const insertData = issues.map(issue => ({
    chat_id: chatId,
    category_id: issue.category_id,
    priority: issue.urgency || issue.priority || 'medium',
    department: issue.department || 'Support',
    summary: issue.problem_summary || issue.summary || 'ไม่มีบทสรุป',
    recommended_reply: issue.recommended_reply || ''
  }));

  const { error: insError } = await supabase
    .from('chat_issues')
    .insert(insertData);

  if (insError) {
    throw new Error(`Failed to insert chat issues for ${chatId}: ${insError.message}`);
  }
}

/**
 * Update multiple chat issues after human audit.
 * @param {any[]} issues - Array of issues to update.
 */
export async function updateChatIssues(issues) {
  for (const issue of issues) {
    const { error } = await supabase
      .from('chat_issues')
      .update({
        category_id: issue.category_id,
        priority: issue.priority,
        summary: issue.summary,
        recommended_reply: issue.recommended_reply || ''
      })
      .eq('id', issue.id);

    if (error) {
      throw new Error(`Failed to update chat issue ${issue.id}: ${error.message}`);
    }
  }
}

/**
 * Authenticate a company using client_id and client_secret.
 * @param {string} clientId
 * @param {string} clientSecret
 * @returns {Promise<any>} The company record if found, or null.
 */
export async function authenticateCompany(clientId, clientSecret) {
  if (!clientId || !clientSecret) return null;
  const { data, error } = await supabase
    .from('companies')
    .select('id, name')
    .eq('client_id', clientId)
    .eq('client_secret', clientSecret)
    .maybeSingle();

  if (error) {
    console.error('Error authenticating company:', error.message);
    return null;
  }
  return data;
}

/**
 * Copy categories from the first company (Mika Co.) to a new company (Copy-on-Registration).
 * @param {string} newCompanyId
 */
export async function initializeCompanyCategories(newCompanyId) {
  // 1. Get the first company (Mika Co.)
  const { data: firstCompany, error: compErr } = await supabase
    .from('companies')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (compErr || !firstCompany) {
    throw new Error('Failed to find templates source company: ' + (compErr ? compErr.message : 'No company found'));
  }

  // If the new company is the first company itself, do not copy
  if (firstCompany.id === newCompanyId) return;

  // 2. Fetch categories from the first company
  const { data: templates, error: catErr } = await supabase
    .from('categories')
    .select('*')
    .eq('company_id', firstCompany.id);

  if (catErr) {
    throw new Error('Failed to fetch template categories: ' + catErr.message);
  }

  if (templates && templates.length > 0) {
    const insertData = templates.map(cat => {
      const rawCatId = cat.id.includes(':') ? cat.id.split(':').slice(1).join(':') : cat.id;
      const row = {
        id: `${newCompanyId}:${rawCatId}`,
        name: cat.name,
        description: cat.description,
        embedding: cat.embedding,
        company_id: newCompanyId
      };
      if (cat.name_en) {
        row.name_en = cat.name_en;
      }
      return row;
    });

    const { error: insErr } = await supabase
      .from('categories')
      .upsert(insertData);

    if (insErr) {
      throw new Error('Failed to clone default categories: ' + insErr.message);
    }
  }
}

// ==========================================
// User Management Functions (RBAC)
// ==========================================

// Role hierarchy: system_admin > super_admin > admin > agent
const ROLE_HIERARCHY = { system_admin: 4, super_admin: 3, admin: 2, agent: 1 };

/**
 * Authenticate a user by email and password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object|null>} User object with company info, or null
 */
export async function authenticateUser(email, password) {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, role, company_id, is_active, permissions')
    .eq('email', email)
    .eq('password', password)
    .limit(1);

  if (error || !data || data.length === 0) return null;
  const user = data[0];
  if (!user.is_active) return null;

  // Fetch company info if user belongs to one
  let company = null;
  if (data.company_id) {
    const { data: comp } = await supabase
      .from('companies')
      .select('id, name, domain, client_id, client_secret')
      .eq('id', data.company_id)
      .single();
    company = comp;
  }

  return { ...data, company };
}

/**
 * Get all users. If companyId is provided, filter by company.
 * System admin can see all users across all companies.
 * @param {string} [companyId]
 * @returns {Promise<any[]>}
 */
export async function getAllUsers(companyId) {
  let query = supabase
    .from('users')
    .select('id, email, name, role, company_id, is_active, created_at, permissions')
    .order('created_at', { ascending: true });

  if (companyId) {
    query = query.eq('company_id', companyId);
  }

  const { data, error } = await query;
  if (error) throw new Error('Failed to fetch users: ' + error.message);
  return data || [];
}

/**
 * Create a new user.
 * @param {object} userData - { email, name, role, company_id, password, permissions }
 * @returns {Promise<object>}
 */
export async function createUser({ email, name, role, company_id, password, permissions }) {
  // Check for duplicate email
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  if (existing) {
    throw new Error('อีเมลนี้ถูกใช้งานแล้ว');
  }

  // Sanitize company_id for system_admin or invalid types
  let cleanCompanyId = company_id;
  if (role === 'system_admin' || !company_id) {
    cleanCompanyId = null;
  } else if (typeof company_id === 'string' && company_id.includes(',')) {
    cleanCompanyId = company_id.split(',')[0].trim() || null;
  }

  // Set default permissions based on role if not provided
  let userPermissions = permissions;
  if (!userPermissions) {
    if (role === 'system_admin') {
      userPermissions = ['view_dashboard', 'view_chats', 'manage_categories', 'manage_users', 'manage_companies', 'export_csv'];
    } else if (role === 'super_admin') {
      userPermissions = ['view_dashboard', 'view_chats', 'manage_categories', 'manage_users', 'export_csv'];
    } else if (role === 'admin') {
      userPermissions = ['view_dashboard', 'view_chats', 'manage_categories', 'export_csv'];
    } else {
      userPermissions = ['view_chats'];
    }
  }

  const { data, error } = await supabase
    .from('users')
    .insert({
      email,
      name,
      role: role || 'agent',
      company_id: cleanCompanyId,
      password: password || '123456',
      is_active: true,
      permissions: userPermissions
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create user: ' + error.message);
  return data;
}

/**
 * Update a user by ID.
 * @param {string} id
 * @param {object} updates - Fields to update
 * @returns {Promise<object>}
 */
export async function updateUser(id, updates) {
  // Only allow updating safe fields
  const allowedFields = ['name', 'role', 'company_id', 'password', 'is_active', 'permissions'];
  const safeUpdates = {};
  for (const key of allowedFields) {
    if (updates[key] !== undefined) {
      safeUpdates[key] = updates[key];
    }
  }

  // Sanitize company_id for system_admin or invalid types
  if (safeUpdates.role === 'system_admin') {
    safeUpdates.company_id = null;
    // System admin should get all permissions
    if (!safeUpdates.permissions) {
      safeUpdates.permissions = ['view_dashboard', 'view_chats', 'manage_categories', 'manage_users', 'manage_companies', 'export_csv'];
    }
  } else if (safeUpdates.company_id !== undefined) {
    if (!safeUpdates.company_id) {
      safeUpdates.company_id = null;
    } else if (typeof safeUpdates.company_id === 'string' && safeUpdates.company_id.includes(',')) {
      safeUpdates.company_id = safeUpdates.company_id.split(',')[0].trim() || null;
    }
  }

  const { data, error } = await supabase
    .from('users')
    .update(safeUpdates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error('Failed to update user: ' + error.message);
  return data;
}

/**
 * Delete a user by ID.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function deleteUser(id) {
  const { data, error } = await supabase
    .from('users')
    .delete()
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error('Failed to delete user: ' + error.message);
  return data;
}

/**
 * Get all companies (for system_admin).
 * @returns {Promise<any[]>}
 */
export async function getAllCompanies() {
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, domain, client_id, created_at')
    .order('created_at', { ascending: true });

  if (error) throw new Error('Failed to fetch companies: ' + error.message);
  return data || [];
}

/**
 * Get all customers.
 * @param {string} [companyId]
 * @returns {Promise<any[]>}
 */
export async function getAllCustomers(companyId) {
  let query = supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false });

  if (companyId) {
    query = query.eq('company_id', companyId);
  }

  const { data, error } = await query;
  if (error) throw new Error('Failed to fetch customers: ' + error.message);
  return data || [];
}

/**
 * Create a new customer.
 * @param {object} customerData
 * @returns {Promise<object>}
 */
export async function createCustomer(customerData) {
  let { id, name, email, phone } = customerData;
  if (!name) throw new Error('กรุณาระบุชื่อลูกค้า (name)');

  if (!id) {
    const { data: existing } = await supabase.from('customers').select('id');
    const count = existing ? existing.length + 1 : 1;
    id = `cust-${String(count).padStart(3, '0')}`;
  }

  const payload = {
    id,
    name,
    email: email || null,
    phone: phone || null
  };

  const { data, error } = await supabase
    .from('customers')
    .insert([payload])
    .select()
    .single();

  if (error) throw new Error('Failed to create customer: ' + error.message);
  return data;
}

/**
 * Update an existing customer.
 * @param {string} id
 * @param {object} updates
 * @returns {Promise<object>}
 */
export async function updateCustomer(id, updates) {
  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error('Failed to update customer: ' + error.message);
  return data;
}

/**
 * Delete a customer.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function deleteCustomer(id) {
  const { data, error } = await supabase
    .from('customers')
    .delete()
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error('Failed to delete customer: ' + error.message);
  return data;
}

export { ROLE_HIERARCHY };
