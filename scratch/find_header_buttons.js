async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/40ivo5auqjjbc.js');
  const code = await res.text();

  // Look for switchLanguage or language toggle in 40ivo5auqjjbc.js
  const idx = code.indexOf('switchLanguage');
  console.log('switchLanguage in 40ivo5auqjjbc.js:', idx);

  // Search for buttons near header or user profile
  // In Image 1, top right has: "ป๊อปอัพหน้าจอ: ปิด", "เสียงเคสด่วน: ปิด", Settings icon, and [TH | EN] toggle!
  const terms = ['ป๊อปอัพหน้าจอ', 'เสียงเคสด่วน', 'TH', 'EN'];
  for (const t of terms) {
    let i = code.indexOf(t);
    console.log(`Term "${t}": ${i !== -1 ? 'FOUND at ' + i : 'NOT FOUND'}`);
  }
}
run();
