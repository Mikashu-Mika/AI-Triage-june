import https from 'https';

const chunks = [
  '/_next/static/chunks/3rxl-jt3pdxgx.js',
  '/_next/static/chunks/0r3aw-0x66p7l.js',
  '/_next/static/chunks/2ldtg-9c048gv.js',
  '/_next/static/chunks/3yiddnbtmgj46.js'
];

async function fetchChunk(url) {
  return new Promise(resolve => {
    https.get('https://ai-triage-eta.vercel.app' + url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
  });
}

async function run() {
  for (const s of chunks) {
    const code = await fetchChunk(s);
    console.log(`Checking ${s} (length: ${code.length})`);
    
    // Look for select or company change
    const regex = /(?:company|tenant|selectedCompany|activeCompany|setCompany|companies)/gi;
    let match;
    let count = 0;
    while ((match = regex.exec(code)) !== null && count < 8) {
      count++;
      const start = Math.max(0, match.index - 100);
      const end = Math.min(code.length, match.index + 200);
      console.log(`--- [${match[0]} in ${s}] ---`);
      console.log(code.slice(start, end));
    }
  }
}

run();
