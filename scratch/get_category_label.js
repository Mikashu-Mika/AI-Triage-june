async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/3fkblj52d817p.js');
  const code = await res.text();

  const idx = code.indexOf('getCategoryLabel');
  console.log('getCategoryLabel definition:');
  console.log(code.slice(idx - 100, idx + 1800));
}

run();
