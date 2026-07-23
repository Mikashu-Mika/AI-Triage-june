import dotenv from 'dotenv';
import { supabase } from './supabase.js';

dotenv.config();

const EXAMPLES_TEMPLATE = [
  // 1. deposit_withdrawal (ปัญหาฝาก-ถอน)
  {
    input_text: 'ลูกค้า: โอนเงินเข้าระบบแล้วยอดไม่ขึ้นค่ะ รบกวนตรวจสอบด่วน',
    expected_output: JSON.stringify({
      category_id: 'deposit_withdrawal',
      sub_category: 'ฝากเงินไม่เข้า',
      intent: 'deposit',
      root_cause: 'ระบบปรับยอดดีเลย์',
      sentiment: 'สับสน',
      urgency: 'high',
      priority: 'high',
      department: 'Finance',
      resolution: 'Pending',
      business_impact: 'Revenue Risk',
      business_impact_score: 80.0
    }),
    task_type: 'triage'
  },
  {
    input_text: 'ลูกค้า: ถอนเงินไปครึ่งชั่วโมงแล้วยังไม่เข้าบัญชีเลยค่ะ ทำไมช้าจัง',
    expected_output: JSON.stringify({
      category_id: 'deposit_withdrawal',
      sub_category: 'ถอนเงินล่าช้า',
      intent: 'withdraw',
      root_cause: 'ธนาคารปลายทางขัดข้อง',
      sentiment: 'ไม่พอใจ',
      urgency: 'high',
      priority: 'high',
      department: 'Finance',
      resolution: 'Pending',
      business_impact: 'Revenue Risk',
      business_impact_score: 85.0
    }),
    task_type: 'triage'
  },

  // 2. login_issue (ปัญหาการเข้าสู่ระบบ)
  {
    input_text: 'ลูกค้า: เข้าสู่ระบบไม่ได้ค่ะ มันฟ้องว่ารหัสผ่านไม่ถูกต้อง ทั้งที่พิมพ์ถูกแล้ว',
    expected_output: JSON.stringify({
      category_id: 'login_issue',
      sub_category: 'รหัสผ่านผิดพลาด',
      intent: 'verify',
      root_cause: 'ปัญหาระบบฐานข้อมูลผู้ใช้งาน',
      sentiment: 'สับสน',
      urgency: 'medium',
      priority: 'medium',
      department: 'Support',
      resolution: 'Pending',
      business_impact: 'Customer Risk',
      business_impact_score: 50.0
    }),
    task_type: 'triage'
  },

  // 3. registration (ปัญหาการสมัครสมาชิก)
  {
    input_text: 'ลูกค้า: สมัครสมาชิกใหม่ไม่ได้ค่ะ กดปุ่มสมัครแล้วเงียบไปเลย ไม่มีอะไรเกิดขึ้น',
    expected_output: JSON.stringify({
      category_id: 'registration',
      sub_category: 'สมัครสมาชิกไม่ได้',
      intent: 'register',
      root_cause: 'สคริปต์หน้าสมัครสมาชิกค้าง',
      sentiment: 'สับสน',
      urgency: 'medium',
      priority: 'medium',
      department: 'Support',
      resolution: 'Pending',
      business_impact: 'Customer Risk',
      business_impact_score: 45.0
    }),
    task_type: 'triage'
  },

  // 4. page_load_freeze (หน้าเว็บค้าง/โหลดช้า)
  {
    input_text: 'ลูกค้า: หน้าเว็บมันค้างอยู่หน้าแรก โหลดแถบวิ่งไม่เสร็จสักที เข้าเล่นไม่ได้เลย',
    expected_output: JSON.stringify({
      category_id: 'page_load_freeze',
      sub_category: 'หน้าเว็บโหลดไม่เสร็จ',
      intent: 'report_issue',
      root_cause: 'ทรัพยากรหน้าเว็บหนักเกินไป',
      sentiment: 'ไม่พอใจ',
      urgency: 'medium',
      priority: 'medium',
      department: 'Developer',
      resolution: 'Pending',
      business_impact: 'Customer Risk',
      business_impact_score: 60.0
    }),
    task_type: 'triage'
  },

  // 5. interaction_lag (กดปุ่มแล้วไม่ตอบสนอง)
  {
    input_text: 'ลูกค้า: แอดมินหน้าเว็บคลิ๊กอะไรไม่ได้เลย กดไปหน้าโปรไฟล์ก็ไม่ได้ ปุ่มนิ่งสนิทค่ะ',
    expected_output: JSON.stringify({
      category_id: 'interaction_lag',
      sub_category: 'ปุ่มกดไม่ตอบสนอง',
      intent: 'report_issue',
      root_cause: 'ระบบจาวาสคริปต์หน้าเว็บขัดข้อง',
      sentiment: 'สับสน',
      urgency: 'medium',
      priority: 'medium',
      department: 'Developer',
      resolution: 'Pending',
      business_impact: 'Customer Risk',
      business_impact_score: 55.0
    }),
    task_type: 'triage'
  },

  // 6. ui_rendering_issue (การแสดงผลผิดเพี้ยน)
  {
    input_text: 'ลูกค้า: ตัวหนังสือบนหน้าจอมันซ้อนกันอ่านไม่รู้เรื่องเลยค่ะ จัดหน้ามั่วไปหมด',
    expected_output: JSON.stringify({
      category_id: 'ui_rendering_issue',
      sub_category: 'ดีไซน์หน้าจอเพี้ยน',
      intent: 'report_issue',
      root_cause: 'CSS Layout ผิดพลาด',
      sentiment: 'ปกติ',
      urgency: 'low',
      priority: 'low',
      department: 'Developer',
      resolution: 'Pending',
      business_impact: 'None',
      business_impact_score: 10.0
    }),
    task_type: 'triage'
  },

  // 7. other / ไม่ใช่ปัญหา (สอบถามทั่วไป / ทำรายการปกติ)
  {
    input_text: 'ลูกค้า: ขอบช หน่อยค่ะ จะโอนเงินฝากเข้าเล่น',
    expected_output: JSON.stringify({
      category_id: 'other',
      sub_category: 'ขอเลขบัญชี',
      intent: 'deposit',
      root_cause: 'None (General Inquiry / Standard Request)',
      sentiment: 'ปกติ',
      urgency: 'low',
      priority: 'low',
      department: 'Support',
      resolution: 'Solved',
      business_impact: 'None',
      business_impact_score: 0.0
    }),
    task_type: 'triage'
  },
  {
    input_text: 'ลูกค้า: สวัสดีค่ะ มีโปรโมชั่นแนะนำสำหรับสมาชิกใหม่บ้างไหมคะ',
    expected_output: JSON.stringify({
      category_id: 'other',
      sub_category: 'สอบถามโปรโมชั่น',
      intent: 'inquire',
      root_cause: 'None (General Inquiry / Standard Request)',
      sentiment: 'ปกติ',
      urgency: 'low',
      priority: 'low',
      department: 'Support',
      resolution: 'Solved',
      business_impact: 'None',
      business_impact_score: 0.0
    }),
    task_type: 'triage'
  },
  {
    input_text: 'ลูกค้า: ขอโบนัสไทม์หน่อยค่ะแอดมิน',
    expected_output: JSON.stringify({
      category_id: 'other',
      sub_category: 'ขอรับโบนัส',
      intent: 'promotion',
      root_cause: 'None (General Inquiry / Standard Request)',
      sentiment: 'ปกติ',
      urgency: 'low',
      priority: 'low',
      department: 'Support',
      resolution: 'Solved',
      business_impact: 'None',
      business_impact_score: 0.0
    }),
    task_type: 'triage'
  }
];

async function seed() {
  console.log('=== Seeding Dynamic Few-Shot Training Examples ===');
  try {
    // 1. Fetch active company ID
    const { data: companies, error: compErr } = await supabase
      .from('companies')
      .select('id')
      .limit(1);
      
    if (compErr) throw compErr;
    if (!companies || companies.length === 0) {
      throw new Error('No active company found. Please seed companies first.');
    }
    
    const companyId = companies[0].id;
    console.log(`- Loaded Company ID: ${companyId}`);

    // 2. Clean old triage examples
    console.log('- Cleaning old triage examples...');
    await supabase.from('training_examples').delete().eq('task_type', 'triage');
    
    // 3. Attach company_id to examples
    const finalExamples = EXAMPLES_TEMPLATE.map(ex => ({
      ...ex,
      company_id: companyId
    }));

    // 4. Insert new high quality examples
    console.log(`- Inserting ${finalExamples.length} high-quality examples...`);
    const { data, error } = await supabase
      .from('training_examples')
      .insert(finalExamples)
      .select();

    if (error) throw error;
    console.log(`✅ Seeding successful! Inserted ${data.length} records.`);
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
  }
}

seed();
