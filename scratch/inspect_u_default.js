async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/3fnmdy_l1uo6s.js');
  const code = await res.text();

  // Find where `u` is defined in 3fnmdy_l1uo6s.js
  const idx = code.indexOf('(0,t.jsx)(u.default,{})');
  console.log('Snippet around u.default:');
  console.log(code.slice(idx - 300, idx + 200));

  // Let's find imports at top of file
  console.log('Top of file:');
  console.log(code.slice(0, 800));
}
run();
