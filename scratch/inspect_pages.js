async function run() {
  // Let's fetch /chats page or /dashboard page or root
  const pages = ['/', '/chats', '/categories'];
  for (const page of pages) {
    const res = await fetch('https://ai-triage-eta.vercel.app' + page);
    const html = await res.text();
    console.log(`Page ${page}: status ${res.status}, length ${html.length}`);
    const scripts = [...html.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
    console.log(`Scripts in ${page}:`, scripts);
  }
}

run().catch(console.error);
