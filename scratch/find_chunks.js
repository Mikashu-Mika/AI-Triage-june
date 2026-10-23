async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/turbopack-34e0_1jn_4-6q.js');
  const code = await res.text();
  console.log('turbopack chunk length:', code.length);

  // Find all .js chunk names mentioned in turbopack runtime
  const matches = [...code.matchAll(/static\/chunks\/[a-zA-Z0-9_\-\.]+\.js/g)].map(m => m[0]);
  console.log('Found chunk paths in turbopack:', [...new Set(matches)]);

  const res2 = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/0-hgim4nm-jfp.js');
  const code2 = await res2.text();
  const matches2 = [...code2.matchAll(/static\/chunks\/[a-zA-Z0-9_\-\.]+\.js/g)].map(m => m[0]);
  console.log('Found chunk paths in 0-hgim4nm-jfp:', [...new Set(matches2)]);

  // Let's also check for manifest files
  const manifests = [
    '/_next/static/development/_buildManifest.js',
    '/_next/static/production/_buildManifest.js',
    '/_next/static/development/_ssgManifest.js'
  ];
  for (const m of manifests) {
    const r = await fetch('https://ai-triage-eta.vercel.app' + m);
    console.log(m, r.status);
  }
}

run().catch(console.error);
