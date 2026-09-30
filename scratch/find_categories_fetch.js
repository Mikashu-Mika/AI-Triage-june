async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/_next/static/chunks/3fnmdy_l1uo6s.js');
  const code = await res.text();

  // Find where categories are fetched
  const idx = code.indexOf('/api/categories');
  console.log('/api/categories in 3fnmdy_l1uo6s.js:', idx);
  if (idx !== -1) {
    console.log(code.slice(idx - 150, idx + 400));
  } else {
    // Maybe supabase.from('categories')
    const idx2 = code.indexOf('from("categories")');
    console.log('from("categories"):', idx2);
    if (idx2 !== -1) {
      console.log(code.slice(idx2 - 150, idx2 + 400));
    }
  }
}

run();
