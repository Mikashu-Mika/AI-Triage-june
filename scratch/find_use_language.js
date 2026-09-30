async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/3fnmdy_l1uo6s.js');
  const code = await res.text();

  // Find "useLanguage" in the file
  let idx = 0;
  while ((idx = code.indexOf('useLanguage', idx)) !== -1) {
    console.log('useLanguage call:', code.slice(Math.max(0, idx - 50), Math.min(code.length, idx + 200)));
    idx += 11;
  }
}

run();
