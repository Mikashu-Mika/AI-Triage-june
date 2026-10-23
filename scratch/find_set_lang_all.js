async function run() {
  const scripts = [
    '/_next/static/chunks/3rxl-jt3pdxgx.js',
    '/_next/static/chunks/0-hgim4nm-jfp.js',
    '/_next/static/chunks/27jktro2p5rq9.js',
    '/_next/static/chunks/0cz1d0mv5g_q7.js',
    '/_next/static/chunks/3yiddnbtmgj46.js'
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
