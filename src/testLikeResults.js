import dotenv from 'dotenv';
import { supabase } from './supabase.js';

dotenv.config();

async function test() {
  console.log('Testing access to like_results...');
  const { data, error } = await supabase
    .from('like_results')
    .select('id')
    .limit(1);

  if (error) {
    console.error('❌ Error accessing like_results:', error.message);
  } else {
    console.log('✅ Access to like_results is successful! Result count:', data.length);
  }
}

test();
