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

  // Fallback: If the company has no categories yet, use the template company's set
  // (the same source initializeCompanyCategories clones from), never other tenants' mixed categories
  let list = data;
  if ((!list || list.length === 0) && companyId) {
    const { data: templateCompany } = await supabase
      .from('companies')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (templateCompany && templateCompany.id !== companyId) {
      const { data: templateData } = await supabase.from('categories').select('*').eq('company_id', templateCompany.id);
      list = templateData || [];
    }
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
 * @param {string} [companyId] - Only return chats of this company.
 * @returns {Promise<any[]>}
 */
export async function findSimilarChats(embedding, threshold = 0.7, limit = 5, companyId = null) {
  if (!embedding) return [];

  // match_chats searches across all companies, so over-fetch and keep only this company's chats
  const { data, error } = await supabase.rpc('match_chats', {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: companyId ? limit * 10 : limit
  });

  if (error) {
    console.error('Error in match_chats RPC:', error.message);
    return [];
  }

  const matches = data || [];
  if (!companyId || matches.length === 0) return matches.slice(0, limit);

  const { data: owned, error: ownErr } = await supabase
    .from('chats')
    .select('id')
    .eq('company_id', companyId)
    .in('id', matches.map(m => m.id));
  if (ownErr) {
    console.error('Error scoping similar chats to company:', ownErr.message);
    return [];
  }

  const ownedIds = new Set((owned || []).map(c => c.id));
  return matches.filter(m => ownedIds.has(m.id)).slice(0, limit);
}

/**
 * Fetch every row of a query, page by page (PostgREST returns at most 1000 rows per request).
 * @param {() => any} buildQuery - Returns a fresh Supabase query builder (without range).
 * @param {number} [pageSize]
 * @returns {Promise<{ data: any[]|null, error: any }>}
 */
export async function fetchAllRows(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return { data: rows, error: null };
}

/**
 * Fetch customers that belong to a company.
 * Legacy customers have no company_id, so they are attributed through the company's chats.
 * @param {string} [companyId] - The ID of the company (all customers if omitted).
 * @returns {Promise<{ data: any[], error: any }>}
 */
export async function getCompanyCustomers(companyId) {
  if (!companyId) {
    return await fetchAllRows(() => supabase.from('customers').select('*').order('created_at', { ascending: false }));
  }

  const { data: owned, error: ownedErr } = await fetchAllRows(() => supabase
    .from('customers')
    .select('*')
    .eq('company_id', companyId)
    .order('id'));
  if (ownedErr) return { data: null, error: ownedErr };

  const { data: companyChats, error: chatErr } = await fetchAllRows(() => supabase
    .from('chats')
    .select('customer_id')
    .eq('is_test', false)
    .eq('company_id', companyId)
    .not('customer_id', 'is', null)
    .order('id'));
  if (chatErr) return { data: null, error: chatErr };

  const ownedIds = new Set((owned || []).map(c => c.id));
  const legacyIds = [...new Set((companyChats || []).map(c => c.customer_id))].filter(id => !ownedIds.has(id));

  let legacy = [];
  for (let i = 0; i < legacyIds.length; i += 200) {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .is('company_id', null)
      .in('id', legacyIds.slice(i, i + 200));
    if (error) return { data: null, error };
    legacy.push(...(data || []));
  }

  const merged = [...(owned || []), ...legacy]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { data: merged, error: null };
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
 * Fetch triage training examples for few-shot learning, filtered by company.
 * (training_examples also stores other task types, e.g. 'admin_backoffice' executive queries,
 * which must never be injected into the triage prompt)
 * @param {string} [companyId] - The ID of the company.
 * @returns {Promise<any[]>}
 */
export async function getTrainingExamples(companyId) {
  let query = supabase.from('training_examples').select('*').eq('task_type', 'triage');
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
 * @param {any[]} issues - Array of issues detected by Sift AI.
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
    recommended_reply: ''
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
        recommended_reply: issue.recommended_reply || '',
        // Human-audited issues are protected from AI re-classification
        is_human_verified: true
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
    .select('*')
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
 * Copy categories and the SOP knowledge base from the first company (Mika Co.) to a new company (Copy-on-Registration).
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

  // 3. Clone the template company's SOP knowledge base (each company owns its own copy)
  const { data: sops, error: sopErr } = await supabase
    .from('knowledge_base')
    .select('category_key, title, content, status, source')
    .eq('company_id', firstCompany.id)
    .neq('status', 'archived');
  if (sopErr) {
    console.warn('⚠️ Could not read template knowledge base:', sopErr.message);
    return;
  }
  if (sops && sops.length > 0) {
    const { error: kbErr } = await supabase
      .from('knowledge_base')
      .insert(sops.map(sop => ({ ...sop, company_id: newCompanyId })));
    if (kbErr) console.warn('⚠️ Failed to clone knowledge base:', kbErr.message);
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
  if (user.company_id) {
    const { data: comp } = await supabase
      .from('companies')
      .select('id, name, domain, client_id')
      .eq('id', user.company_id)
      .single();
    company = comp;
  }

  return { ...user, company };
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
 * Get all companies (sanitized by default to prevent client_secret credential leaks).
 * @param {boolean} [includeSecrets=false]
 * @returns {Promise<any[]>}
 */
export async function getAllCompanies(includeSecrets = false) {
  const fields = includeSecrets 
    ? '*' 
    : 'id, name, domain, customer_type, package_tier, custom_quota, package_status, telegram_group_limit, billing_cycle_anchor, created_at';

  const { data, error } = await supabase
    .from('companies')
    .select(fields)
    .order('created_at', { ascending: true });

  if (error) throw new Error('Failed to fetch companies: ' + error.message);
  return data || [];
}

/**
 * Update company subscription package and quota settings.
 * @param {string} companyId 
 * @param {object} packageData 
 * @returns {Promise<object>}
 */
export async function updateCompanyPackage(companyId, packageData) {
  const allowedFields = ['customer_type', 'package_tier', 'custom_quota', 'package_status', 'billing_cycle_anchor', 'telegram_group_limit'];
  const updatePayload = {};
  for (const field of allowedFields) {
    if (packageData[field] !== undefined) {
      updatePayload[field] = packageData[field];
    }
  }

  const { data, error } = await supabase
    .from('companies')
    .update(updatePayload)
    .eq('id', companyId)
    .select('*')
    .single();

  if (error) throw new Error('Failed to update company package: ' + error.message);
  return data;
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

// ==============================================================================
// Multi-Tenant Telegram Group Mapping & Member Role Management (RBAC)
// ==============================================================================

/**
 * Fetch group mapping and associated company details by Telegram Chat ID.
 * @param {string|number} chatId 
 * @returns {Promise<{ groupId: string, chatId: string, groupName: string, companyId: string, companyName: string, isActive: boolean } | null>}
 */
export async function getCompanyByTelegramChatId(chatId) {
  if (!chatId) return null;
  const sChatId = String(chatId);

  try {
    const { data, error } = await supabase
      .from('telegram_groups')
      .select('id, chat_id, group_name, company_id, is_active, companies(id, name)')
      .eq('chat_id', sChatId)
      .maybeSingle();

    if (error) {
      if (error.code !== 'PGRST205') {
        console.warn(`[getCompanyByTelegramChatId] Error fetching group for ${sChatId}:`, error.message);
      }
      return null;
    }

    if (!data || !data.is_active || !data.company_id) {
      return null;
    }

    return {
      groupId: data.id,
      chatId: data.chat_id,
      groupName: data.group_name,
      companyId: data.company_id,
      companyName: data.companies ? data.companies.name : '',
      isActive: data.is_active
    };
  } catch (err) {
    console.warn(`[getCompanyByTelegramChatId] Exception:`, err.message);
    return null;
  }
}

/**
 * Upsert Telegram Group record.
 * @param {object} param0
 * @param {string|number} param0.chatId
 * @param {string} [param0.groupName]
 * @param {string} [param0.companyId]
 * @param {boolean} [param0.isActive]
 * @returns {Promise<object|null>}
 */
export async function upsertTelegramGroup({ chatId, groupName = 'Telegram Group', companyId = null, isActive = true }) {
  if (!chatId) return null;
  const sChatId = String(chatId);

  try {
    const payload = {
      chat_id: sChatId,
      group_name: groupName || 'Telegram Group',
      is_active: isActive !== false,
      updated_at: new Date().toISOString()
    };
    if (companyId) {
      payload.company_id = companyId;
    }

    const { data, error } = await supabase
      .from('telegram_groups')
      .upsert(payload, { onConflict: 'chat_id' })
      .select()
      .maybeSingle();

    if (error) {
      if (error.code !== 'PGRST205') {
        console.warn(`[upsertTelegramGroup] Warning: ${error.message}`);
      }
      return null;
    }
    return data;
  } catch (err) {
    console.warn(`[upsertTelegramGroup] Exception:`, err.message);
    return null;
  }
}

/**
 * Upsert a Telegram member into telegram_group_members.
 * Automatically captures contact_id, first_name, last_name, username, and updates last_seen_at.
 * Preserves existing role ('executive', 'admin') unless explicitly overwritten.
 * Default role for newly inserted members is 'member'.
 * 
 * @param {object} memberData
 * @param {string|number} memberData.groupId - Telegram Chat ID
 * @param {string|number} memberData.telegramUserId - Contact ID / Telegram User ID
 * @param {string} [memberData.firstName]
 * @param {string} [memberData.lastName]
 * @param {string} [memberData.username]
 * @param {string} [memberData.role] - 'member', 'executive', 'admin', 'blocked'
 * @returns {Promise<object|null>}
 */
export async function upsertTelegramMember({
  groupId,
  telegramUserId,
  firstName = '',
  lastName = '',
  username = '',
  role = null
}) {
  if (!groupId || !telegramUserId) return null;
  const sGroupId = String(groupId);
  const sUserId = String(telegramUserId);

  try {
    // Check if member already exists to preserve established executive/admin role
    const { data: existing, error: selectErr } = await supabase
      .from('telegram_group_members')
      .select('id, role')
      .eq('group_id', sGroupId)
      .eq('telegram_user_id', sUserId)
      .maybeSingle();

    if (selectErr && selectErr.code === 'PGRST205') {
      return null;
    }

    const finalRole = role || (existing ? existing.role : 'member');

    const payload = {
      group_id: sGroupId,
      telegram_user_id: sUserId,
      first_name: firstName || '',
      last_name: lastName || '',
      username: username || '',
      role: finalRole,
      is_active: true,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('telegram_group_members')
      .upsert(payload, { onConflict: 'group_id,telegram_user_id' })
      .select()
      .maybeSingle();

    if (error) {
      if (error.code !== 'PGRST205') {
        console.warn(`[upsertTelegramMember] Warning: ${error.message}`);
      }
      return null;
    }
    return data;
  } catch (err) {
    console.warn(`[upsertTelegramMember] Exception:`, err.message);
    return null;
  }
}

/**
 * Fetch role of a Telegram user in a specific group.
 * @param {string|number} groupId - Telegram Chat ID
 * @param {string|number} telegramUserId - Telegram User ID / Contact ID
 * @returns {Promise<'executive'|'member'|'admin'|'blocked'|null>}
 */
export async function getTelegramMemberRole(groupId, telegramUserId) {
  if (!groupId || !telegramUserId) return null;
  const sGroupId = String(groupId);
  const sUserId = String(telegramUserId);

  try {
    const { data, error } = await supabase
      .from('telegram_group_members')
      .select('role, is_active')
      .eq('group_id', sGroupId)
      .eq('telegram_user_id', sUserId)
      .maybeSingle();

    if (error) {
      if (error.code !== 'PGRST205') {
        console.warn(`[getTelegramMemberRole] Warning: ${error.message}`);
      }
      return null;
    }

    if (!data || !data.is_active) return null;
    return data.role || 'member';
  } catch (err) {
    console.warn(`[getTelegramMemberRole] Exception:`, err.message);
    return null;
  }
}

/**
 * Fetch list of Telegram Groups (optionally filtered by companyId).
 * @param {string} [companyId]
 * @returns {Promise<any[]>}
 */
export async function getTelegramGroups(companyId = null) {
  try {
    let query = supabase
      .from('telegram_groups')
      .select('id, chat_id, group_name, company_id, is_active, created_at, updated_at, companies(id, name)');

    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      if (error.code !== 'PGRST205') {
        console.warn(`[getTelegramGroups] Warning: ${error.message}`);
      }
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn(`[getTelegramGroups] Exception:`, err.message);
    return [];
  }
}

/**
 * Fetch all members of a Telegram group.
 * @param {string|number} groupId - Telegram Chat ID
 * @returns {Promise<any[]>}
 */
export async function getTelegramGroupMembers(groupId) {
  if (!groupId) return [];
  const sGroupId = String(groupId);

  try {
    const { data, error } = await supabase
      .from('telegram_group_members')
      .select('*')
      .eq('group_id', sGroupId)
      .order('role', { ascending: true })
      .order('last_seen_at', { ascending: false });

    if (error) {
      if (error.code !== 'PGRST205') {
        console.warn(`[getTelegramGroupMembers] Warning: ${error.message}`);
      }
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn(`[getTelegramGroupMembers] Exception:`, err.message);
    return [];
  }
}

/**
 * Update member role in a group (for Backoffice use).
 * @param {string|number} groupId - Telegram Chat ID
 * @param {string|number} telegramUserId - Telegram User ID
 * @param {'executive'|'member'|'admin'|'blocked'} role
 * @returns {Promise<object>}
 */
export async function updateTelegramMemberRole(groupId, telegramUserId, role) {
  if (!groupId || !telegramUserId || !role) {
    throw new Error('กรุณาระบุ groupId, telegramUserId และ role ให้ครบถ้วน');
  }

  const validRoles = ['executive', 'member', 'admin', 'blocked'];
  if (!validRoles.includes(role)) {
    throw new Error(`Role ไม่ถูกต้อง (ต้องเป็นหนึ่งใน: ${validRoles.join(', ')})`);
  }

  const { data, error } = await supabase
    .from('telegram_group_members')
    .update({
      role,
      updated_at: new Date().toISOString()
    })
    .eq('group_id', String(groupId))
    .eq('telegram_user_id', String(telegramUserId))
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update member role: ${error.message}`);
  }
  return data;
}

export { ROLE_HIERARCHY };
