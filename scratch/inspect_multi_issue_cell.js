async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/3fnmdy_l1uo6s.js');
  const code = await res.text();

  const idx = code.indexOf('(a=k.find(t=>t.id===e.category_id');
  console.log(code.slice(idx - 100, idx + 600));
}

run();
