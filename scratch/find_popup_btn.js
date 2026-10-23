async function run() {
  const scripts = [
    '/_next/static/chunks/3fkblj52d817p.js',
    '/_next/static/chunks/2hnj1towa3bz9.js',
    '/_next/static/chunks/3fnmdy_l1uo6s.js',
    '/_next/static/chunks/27jktro2p5rq9.js',
    '/_next/static/chunks/3rxl-jt3pdxgx.js',
    '/_next/static/chunks/0-hgim4nm-jfp.js',
    '/_next/static/chunks/turbopack-34e0_1jn_4-6q.js',
    '/_next/static/chunks/1-8s9_t85wwr4.js',
    '/_next/static/chunks/2ldtg-9c048gv.js',
    '/_next/static/chunks/0cz1d0mv5g_q7.js',
    '/_next/static/chunks/3yiddnbtmgj46.js'
  ];

  for (const s of scripts) {
    const res = await fetch('https://ai-triage-eta.vercel.app' + s);
    const code = await res.text();
    if (code.includes('ป๊อปอัพหน้าจอ') || code.includes('เสียงเคสด่วน')) {
      console.log(`Found header buttons in ${s}!`);
      const idx = code.indexOf('เสียงเคสด่วน');
      console.log(code.slice(Math.max(0, idx - 300), Math.min(code.length, idx + 800)));
    }
  }
}
run();
