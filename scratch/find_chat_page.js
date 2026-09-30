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
    // Look for chat modal elements: "ประเด็นย่อย", "sub_category", "chat_issues", "custom_tags"
    if (code.includes('selectedChat') || code.includes('setSelectedChat') || code.includes('chat_issues') || code.includes('ประเด็นย่อย')) {
      console.log(`\n🎉 Found chat page code in ${s}!`);
      // Find snippets
      const terms = ['selectedChat', 'setSelectedChat', 'chat_issues', 'ประเด็นย่อย'];
      for (const t of terms) {
        let idx = 0;
        while ((idx = code.indexOf(t, idx)) !== -1) {
          console.log(`[${t}]:`, code.slice(Math.max(0, idx - 100), Math.min(code.length, idx + 300)));
          idx += t.length + 50;
        }
      }
    }
  }
}
run();
