import dotenv from 'dotenv';
import { supabase } from './supabase.js';
import { getEmbedding } from './ollama.js';

dotenv.config();

async function seedEnterprise() {
  console.log('=== Starting Enterprise Relational Seeding to Supabase ===');

  let companyId = null;
  let userId = null;
  let auditTaskId = null;
  let auditResultId = null;
  let triggerId = null;

  // Helper helper to handle individual seed steps safely
  async function seedStep(name, action) {
    try {
      console.log(`\n- Seeding: ${name}...`);
      await action();
      console.log(`  ✅ ${name} seeded successfully!`);
    } catch (error) {
      console.warn(`  ⚠️ Failed to seed ${name}:`, error.message);
    }
  }

  // 0. Clean up existing data where possible (reverse FK order)
  console.log('0. Cleaning up previous enterprise seed data...');
  const tablesToCleanup = [
    'like_results', 'audit_results', 'audit_tasks',
    'prove_trigger_webhook_log', 'prove_trigger',
    'training_examples', 'knowledge_base', 'prompt_configs',
    'system_ip_whitelist', 'users', 'companies'
  ];

  for (const table of tablesToCleanup) {
    try {
      if (table === 'users') {
        await supabase.from(table).delete().neq('email', 'none-existing-email@test.com');
      } else if (table === 'companies') {
        await supabase.from(table).delete().neq('name', 'none-existing-company');
      } else if (typeof (await supabase.from(table).select('id').limit(1).single()).data?.id === 'number') {
        await supabase.from(table).delete().neq('id', 0);
      } else {
        await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  }
  console.log('✅ Cleanup finished.');

  // 1. Seed Company
  await seedStep('Companies', async () => {
    const { data, error } = await supabase
      .from('companies')
      .insert({
        name: 'Mika Customer Intelligence Co., Ltd.',
        domain: 'mika-intelligence.com'
      })
      .select()
      .single();
    if (error) throw error;
    companyId = data.id;
    console.log(`     Company ID: ${companyId}`);
  });

  if (!companyId) {
    console.error('❌ Cannot proceed: Company seeding failed.');
    return;
  }

  // 2. Seed User
  await seedStep('Users', async () => {
    const { data, error } = await supabase
      .from('users')
      .insert({
        company_id: companyId,
        email: 'mika@mika-intelligence.com',
        name: 'Mika (มิกะ)',
        role: 'admin'
      })
      .select()
      .single();
    if (error) throw error;
    userId = data.id;
    console.log(`     User ID: ${userId}`);
  });

  // 3. Seed IP Whitelist
  await seedStep('System IP Whitelist', async () => {
    const { error } = await supabase
      .from('system_ip_whitelist')
      .insert({
        company_id: companyId,
        ip_address: '127.0.0.1',
        description: 'Localhost Development Office'
      });
    if (error) throw error;
  });

  // 4. Seed Prompt Configs
  await seedStep('Prompt Configs', async () => {
    const { error } = await supabase
      .from('prompt_configs')
      .insert({
        company_id: companyId,
        task_type: 'triage',
        system_prompt: 'You are an AI Customer Intelligence Platform. Analyze chat...',
        model_name: 'qwen2.5:14b',
        is_active: true
      });
    if (error) throw error;
  });

  // 5. Seed Knowledge Base with Embedding
  await seedStep('Knowledge Base', async () => {
    const kbContent = 'ขั้นตอนการทำธุรกรรมฝากถอนเงิน: รายการฝากอัตโนมัติใช้เวลาปรับยอดไม่เกิน 1 นาที หากธนาคารปลายทางเกิดความล่าช้าให้ทีม Finance ดำเนินการคีย์มือทันที';
    const kbEmbedding = await getEmbedding(kbContent);
    const { error } = await supabase
      .from('knowledge_base')
      .insert({
        company_id: companyId,
        title: 'คู่มือการฝากถอนเงินล่าช้า',
        content: kbContent,
        embedding: kbEmbedding
      });
    if (error) throw error;
  });

  // 6. Seed Training Examples
  await seedStep('Training Examples', async () => {
    const { error } = await supabase
      .from('training_examples')
      .insert({
        company_id: companyId,
        input_text: 'ลูกค้า: โอนตังค์มา 10 นาทีแล้วทำไมยังไม่เข้าระบบคะ',
        expected_output: '{"category_id":"deposit_withdrawal","intent":"deposit"}',
        task_type: 'triage'
      });
    if (error) throw error;
  });

  // 7. Seed Prove Trigger (Webhook)
  await seedStep('Prove Trigger', async () => {
    const { data, error } = await supabase
      .from('prove_trigger')
      .insert({
        company_id: companyId,
        event_type: 'triage_completed',
        webhook_url: 'https://api.external-system.com/webhooks/triage',
        secret_token: 'secret_mika_token_abc123',
        is_active: true
      })
      .select()
      .single();
    if (error) throw error;
    triggerId = data.id;
  });

  // 8. Seed Webhook Delivery Log
  if (triggerId) {
    await seedStep('Webhook Delivery Logs', async () => {
      const { error } = await supabase
        .from('prove_trigger_webhook_log')
        .insert({
          trigger_id: triggerId,
          payload: { event: 'triage_completed', chat_id: 'chat-001' },
          response_status: 200,
          response_body: '{"status":"ok"}'
        });
      if (error) throw error;
    });
  }

  // 9. Seed Audit Task
  if (userId) {
    await seedStep('Audit Tasks', async () => {
      const { data, error } = await supabase
        .from('audit_tasks')
        .insert({
          company_id: companyId,
          status: 'completed',
          started_by: userId,
          summary: 'ระบบคัดแยกทำงานผ่านสำเร็จ ครบถ้วน 3 แชตจำลอง'
        })
        .select()
        .single();
      if (error) throw error;
      auditTaskId = data.id;
    });
  }

  // 10. Seed Audit Result
  if (auditTaskId) {
    await seedStep('Audit Results', async () => {
      const { data, error } = await supabase
        .from('audit_results')
        .insert({
          task_id: auditTaskId,
          chat_id: 'chat-001',
          category_id: 'deposit_withdrawal',
          priority: 'high',
          summary: 'ลูกค้ามีปัญหาโอนยอดไม่เข้า',
          is_correct: true
        })
        .select()
        .single();
      if (error) throw error;
      auditResultId = data.id;
    });
  }

  // 11. Seed Like Results
  if (auditResultId && userId) {
    await seedStep('Like Results', async () => {
      const { error } = await supabase
        .from('like_results')
        .insert({
          result_id: auditResultId,
          liked_by: userId,
          is_like: true,
          comment: 'AI วิเคราะห์คำนำทางส่งแผนกได้แม่นยำดีมาก'
        });
      if (error) throw error;
    });
  }

  console.log('\n=== Enterprise Seeding Process Finished ===\n');
}

seedEnterprise();
