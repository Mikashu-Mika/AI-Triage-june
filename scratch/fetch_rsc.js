async function run() {
  // In Next.js App Router, requesting page with `RSC: 1` header returns the flight data (RSC payload)
  const res = await fetch('https://ai-triage-eta.vercel.app/chats', {
    headers: {
      'RSC': '1',
      'Next-Router-State-Tree': '%5B%22%22%2C%7B%22children%22%3A%5B%22chats%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D'
    }
  });

  console.log('RSC status:', res.status);
  const text = await res.text();
  console.log('RSC length:', text.length);

  // Look for .js chunk URLs inside the RSC payload!
  const jsChunks = [...text.matchAll(/static\/chunks\/[a-zA-Z0-9_\-\.]+\.js/g)].map(m => m[0]);
  console.log('Chunks found in /chats RSC:');
  console.log([...new Set(jsChunks)]);
}

run();
