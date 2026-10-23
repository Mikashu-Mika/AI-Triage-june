async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/3fkblj52d817p.js');
  const code = await res.text();

  const idx = code.indexOf('KNOWN_CATEGORY_NAMES');
  console.log(code.slice(idx - 1500, idx + 200));
}

run();
