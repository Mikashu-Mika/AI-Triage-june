async function run() {
  const r = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/2ldtg-9c048gv.js');
  const t = await r.text();
  console.log('Login chunk length:', t.length);

  const idx = t.indexOf('user_session=');
  console.log(t.slice(idx - 150, idx + 350));
}
run();
