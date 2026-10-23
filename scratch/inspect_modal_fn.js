async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/3fnmdy_l1uo6s.js');
  const code = await res.text();

  const idx = code.indexOf('function j({chat:e');
  console.log(code.slice(idx, idx + 1000));
}

run();
