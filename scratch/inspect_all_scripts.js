async function run() {
  const scripts = [
    '/_next/static/chunks/27jktro2p5rq9.js',
    '/_next/static/chunks/3rxl-jt3pdxgx.js',
    '/_next/static/chunks/0-hgim4nm-jfp.js',
    '/_next/static/chunks/turbopack-34e0_1jn_4-6q.js',
    '/_next/static/chunks/40ivo5auqjjbc.js',
    '/_next/static/chunks/1-8s9_t85wwr4.js',
    '/_next/static/chunks/2ldtg-9c048gv.js',
    '/_next/static/chunks/0cz1d0mv5g_q7.js',
    '/_next/static/chunks/3yiddnbtmgj46.js'
  ];

  for (const s of scripts) {
    const res = await fetch('https://ai-triage-eta.vercel.app' + s);
    const code = await res.text();
    console.log(`\n================== Script: ${s} (length: ${code.length}) ==================`);
    
    // Check for "CHAT_ISSUES" or "chat_issues" or "categories" or "getCategory"
    const targets = ['chat_issues', 'categories', 'name_en', 'name_th', 'supabase.from', 'currentLang', 'lang===', 'language'];
    for (const t of targets) {
      const idx = code.toLowerCase().indexOf(t.toLowerCase());
      if (idx !== -1) {
        console.log(`Matched target "${t}" at index ${idx}:`);
        console.log(code.slice(Math.max(0, idx - 100), Math.min(code.length, idx + 250)));
      }
    }
  }
}

run().catch(console.error);
