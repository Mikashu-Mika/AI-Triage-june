async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/40ivo5auqjjbc.js');
  const code = await res.text();
  
  // Find where `a={th:` is defined and what variable name it has, and where it is returned or used
  const idx = code.indexOf('{th:{overview:');
  console.log('Definition snippet:');
  console.log(code.slice(idx - 50, idx + 100));

  // Find end of dictionary
  const enIdx = code.indexOf('auditLoading:"กำลังโหลดบันทึกกิจกรรมย้อนหลัง..."');
  console.log('End of th, start of en:');
  console.log(code.slice(enIdx - 50, enIdx + 150));

  const endDict = code.indexOf('auditLoading:"Loading audit activity history..."}');
  console.log('End of dictionary:');
  console.log(code.slice(endDict, endDict + 500));
}
run();
