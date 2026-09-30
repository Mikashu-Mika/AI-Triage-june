async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app');
  const html = await res.text();
  const scriptMatches = [...html.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
  
  // Also look for other chunks in HTML
  const allChunkMatches = [...html.matchAll(/["']([^"']+\.js)["']/g)].map(m => m[1]).filter(s => s.includes('_next'));
  const uniqueScripts = [...new Set([...scriptMatches, ...allChunkMatches])];
  console.log(`Found ${uniqueScripts.length} scripts to inspect`);

  for (const s of uniqueScripts) {
    const sUrl = s.startsWith('http') ? s : 'https://ai-triage-eta.vercel.app' + s;
    const sRes = await fetch(sUrl);
    if (!sRes.ok) continue;
    const code = await sRes.text();
    
    // Look for where chats or categories table is queried or rendered
    const keywords = ['CHAT_ISSUES', 'chat_issues', 'colCategory', 'selectedCategory', 'categories.map', 'sub_category', 'ประเด็นย่อย'];
    const foundKeywords = keywords.filter(k => code.includes(k));
    if (foundKeywords.length > 0) {
      console.log(`\n=== Script ${s} (length: ${code.length}) matches: ${foundKeywords.join(', ')} ===`);
      for (const kw of foundKeywords) {
        let idx = 0;
        let c = 0;
        while ((idx = code.indexOf(kw, idx)) !== -1 && c < 5) {
          c++;
          const start = Math.max(0, idx - 100);
          const end = Math.min(code.length, idx + 200);
          console.log(`--- [${kw}] ---`);
          console.log(code.slice(start, end));
          idx += kw.length;
        }
      }
    }
  }
}

run().catch(console.error);
