async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/40ivo5auqjjbc.js');
  const code = await res.text();

  // Find where "TH" and "EN" button is rendered in the layout
  let idx = 0;
  while ((idx = code.indexOf('"EN"', idx)) !== -1) {
    console.log('Found "EN" at:', idx);
    console.log(code.slice(Math.max(0, idx - 150), Math.min(code.length, idx + 250)));
    idx += 4;
  }
}

run();
