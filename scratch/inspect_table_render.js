async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/3fnmdy_l1uo6s.js');
  const code = await res.text();

  // Search for category display in the table
  const searchTerms = ['getCategoryLabel', 'colCategory', 'category_id', 'cat_name', 'catLabel'];
  for (const s of searchTerms) {
    let idx = 0;
    while ((idx = code.indexOf(s, idx)) !== -1) {
      console.log(`[${s} at ${idx}]:`);
      console.log(code.slice(Math.max(0, idx - 100), Math.min(code.length, idx + 250)));
      idx += s.length + 50;
    }
  }
}

run();
