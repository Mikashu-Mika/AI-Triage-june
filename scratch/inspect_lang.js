async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/40ivo5auqjjbc.js');
  const code = await res.text();
  console.log('Chunk length:', code.length);

  // Look for language state
  const langIdx = code.indexOf('switchLanguage');
  if (langIdx !== -1) {
    console.log('--- Language definition ---');
    console.log(code.slice(langIdx - 200, langIdx + 1500));
  }
}

run().catch(console.error);
