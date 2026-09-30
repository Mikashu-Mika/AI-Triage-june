async function run() {
  const scripts = [
    '/_next/static/chunks/3fkblj52d817p.js',
    '/_next/static/chunks/2hnj1towa3bz9.js',
    '/_next/static/chunks/3fnmdy_l1uo6s.js',
    '/_next/static/chunks/40ivo5auqjjbc.js',
    '/_next/static/chunks/1-8s9_t85wwr4.js',
    '/_next/static/chunks/2ldtg-9c048gv.js'
  ];

  for (const s of scripts) {
    const res = await fetch('https://ai-triage-eta.vercel.app' + s);
    const code = await res.text();
    // Look for ",12388," or " 12388,"
    const regex = /[,\[]12388[,\]]/g;
    if (regex.test(code)) {
      console.log(`Module 12388 found in ${s}!`);
      let idx = code.indexOf('12388');
      console.log(code.slice(Math.max(0, idx - 50), Math.min(code.length, idx + 1000)));
    }
  }
}
run();
