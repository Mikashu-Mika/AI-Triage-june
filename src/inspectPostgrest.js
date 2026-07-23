import dotenv from 'dotenv';

dotenv.config();

async function inspect() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/`;
  console.log('Fetching OpenAPI schema from:', url);
  try {
    const response = await fetch(url, {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.statusText}`);
    }
    
    const doc = await response.json();
    console.log('\nExposed API Paths (Tables/RPCs):');
    const paths = Object.keys(doc.paths || {});
    paths.filter(p => p !== '/').forEach(p => console.log(' -', p));
  } catch (error) {
    console.error('Error fetching OpenAPI schema:', error.message);
  }
}

inspect();
