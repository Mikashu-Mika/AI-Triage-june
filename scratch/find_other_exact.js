async function run() {
  const scripts = [
    '/_next/static/chunks/3fkblj52d817p.js',
    '/_next/static/chunks/2hnj1towa3bz9.js',
    '/_next/static/chunks/3fnmdy_l1uo6s.js',
    '/_next/static/chunks/40ivo5auqjjbc.js'
  ];

  for (const s of scripts) {
    const res = await fetch('https://ai-triage-eta.vercel.app' + s);
    const code = await res.text();
    let idx = 0;
    while ((idx = code.indexOf('"อื่นๆ"', idx)) !== -1) {
      console.log(`Found exact '"อื่นๆ"' in ${s} at ${idx}:`);
      console.log(code.slice(Math.max(0, idx - 100), Math.min(code.length, idx + 200)));
      idx += 6;
    }
  }
}
run();
