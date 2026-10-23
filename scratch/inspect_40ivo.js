async function run() {
  const r = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/40ivo5auqjjbc.js');
  const t = await r.text();
  console.log('Length:', t.length);

  // Let's search for "Anan" or "อนันต์" or "custom_tags" or "tag" or "modal"
  const terms = ['Anan', 'อนันต์', 'custom_tags', 'tags', 'issues', 'modal', 'category', 'status', 'priority'];
  for (const term of terms) {
    const idx = t.toLowerCase().indexOf(term.toLowerCase());
    console.log(`Term "${term}": ${idx !== -1 ? 'FOUND at ' + idx : 'NOT FOUND'}`);
  }
}
run();
