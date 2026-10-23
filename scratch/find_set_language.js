async function run() {
  const scripts = [
    '/_next/static/chunks/40ivo5auqjjbc.js',
    '/_next/static/chunks/3fnmdy_l1uo6s.js',
    '/_next/static/chunks/1-8s9_t85wwr4.js',
    '/_next/static/chunks/2ldtg-9c048gv.js',
    '/_next/static/chunks/3fkblj52d817p.js'
  ];

  for (const s of scripts) {
    const res = await fetch('https://ai-triage-eta.vercel.app' + s);
    const code = await res.text();
    let idx = 0;
    while ((idx = code.indexOf('setLanguage', idx)) !== -1) {
      console.log(`Found setLanguage in ${s} at ${idx}:`);
      console.log(code.slice(Math.max(0, idx - 100), Math.min(code.length, idx + 250)));
      idx += 11;
    }
  }
}
run();
