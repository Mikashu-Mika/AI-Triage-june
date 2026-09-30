async function run() {
  const files = [
    '/_next/static/chunks/3rxl-jt3pdxgx.js',
    '/_next/static/chunks/0cz1d0mv5g_q7.js',
    '/_next/static/chunks/0-hgim4nm-jfp.js',
    '/_next/static/chunks/1-8s9_t85wwr4.js'
  ];

  for (const f of files) {
    const res = await fetch('https://ai-triage-eta.vercel.app' + f);
    const code = await res.text();
    console.log(`Checking ${f} (${code.length} bytes)...`);
    
    // Look for Thai strings from the modal
    const searchTerms = ['ประวัติการคุย', 'CONVERSATION HISTORY', 'ประเด็นย่อย', 'CHAT_ISSUES', 'การเงินและการชำระเงิน', 'chat_issues', 'categories'];
    for (const term of searchTerms) {
      if (code.includes(term)) {
        console.log(`  -> Found "${term}" in ${f}`);
        let idx = code.indexOf(term);
        console.log('Snippet:', code.slice(Math.max(0, idx - 150), Math.min(code.length, idx + 250)));
      }
    }
  }
}

run().catch(console.error);
