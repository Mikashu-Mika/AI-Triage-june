async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/2hnj1towa3bz9.js');
  const code = await res.text();

  const idx = code.indexOf('12388');
  console.log(code.slice(idx - 50, idx + 800));
}

run();
