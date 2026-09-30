async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app');
  const html = await res.text();
  console.log('HTML length:', html.length);
  const scriptMatches = [...html.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
  console.log('Scripts found:', scriptMatches);
  
  for (const s of scriptMatches) {
    if (!s.includes('_next')) continue;
    const sUrl = s.startsWith('http') ? s : 'https://ai-triage-eta.vercel.app' + s;
    const sRes = await fetch(sUrl);
    const code = await sRes.text();
    
    // Check for category display or language toggle
    if (code.includes('name_en') || code.includes('categories') || code.includes('CHAT_ISSUES') || code.includes('ประเด็นย่อย')) {
      console.log(`\n=== Found relevant code in ${s} ===`);
      console.log('Has name_en:', code.includes('name_en'));
      console.log('Has name_th:', code.includes('name_th'));
      console.log('Has categories:', code.includes('categories'));
      console.log('Has CHAT_ISSUES:', code.includes('CHAT_ISSUES'));
      console.log('Has language toggle:', code.includes('TH') && code.includes('EN'));

      // Find occurrences of CHAT_ISSUES or category dropdown
      const regex = /(?:category|categories|name_en|name_th|chat_issues)/gi;
      let m;
      let count = 0;
      while ((m = regex.exec(code)) !== null && count < 10) {
        count++;
        const start = Math.max(0, m.index - 80);
        const end = Math.min(code.length, m.index + 120);
        console.log(`-- match: ${m[0]} --`);
        console.log(code.slice(start, end).replace(/\s+/g, ' '));
      }
    }
  }
}

run().catch(console.error);
