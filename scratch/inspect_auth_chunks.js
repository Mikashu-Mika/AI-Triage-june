async function run() {
  const chunks = [
    '/_next/static/chunks/3fkblj52d817p.js',
    '/_next/static/chunks/2hnj1towa3bz9.js',
    '/_next/static/chunks/3fnmdy_l1uo6s.js'
  ];

  for (const c of chunks) {
    const res = await fetch('https://ai-triage-eta.vercel.app' + c);
    const code = await res.text();
    console.log(`\n================== ${c} (${code.length} bytes) ==================`);
    
    // Check for "category", "categories", "chat_issues", "name_en", "name_th"
    const terms = ['chat_issues', 'categories', 'name_en', 'name_th', 'name', 'colCategory', 'ประเด็นย่อย', 'CONVERSATION HISTORY'];
    for (const t of terms) {
      let idx = code.indexOf(t);
      if (idx !== -1) {
        console.log(`  -> Found "${t}" at ${idx}`);
        console.log('Snippet:', code.slice(Math.max(0, idx - 100), Math.min(code.length, idx + 300)));
      }
    }
  }
}

run();
