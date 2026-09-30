async function run() {
  const r = await fetch('https://ai-triage-eta.vercel.app');
  const t = await r.text();
  const allJs = [...new Set([...t.matchAll(/([a-zA-Z0-9_\-\/]+\.js)/g)].map(m => m[1]))];
  console.log('All JS references in HTML:');
  console.log(allJs);
}
run();
