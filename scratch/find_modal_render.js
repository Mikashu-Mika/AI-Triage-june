async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/3fnmdy_l1uo6s.js');
  const code = await res.text();

  // Find where component `j` is rendered in JSX: `(0,t.jsx)(j,{`
  const idx = code.indexOf('(0,t.jsx)(j,{');
  console.log('Snippet around (0,t.jsx)(j,{:');
  console.log(code.slice(idx - 150, idx + 500));
}

run();
