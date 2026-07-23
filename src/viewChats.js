import dotenv from 'dotenv';
import { supabase } from './supabase.js';

dotenv.config();

async function view() {
  const { data, error } = await supabase
    .from('chats')
    .select('id, category_id, sub_category, intent, root_cause, sentiment, urgency, priority, department, summary, keywords, confidence, recommended_reply, resolution, business_impact, business_impact_score, ai_recommendation');

  if (error) {
    console.error('Error fetching chats:', error.message);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

view();
