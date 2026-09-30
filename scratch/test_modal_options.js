async function run() {
  const catsRes = await fetch('https://ai-triage-eta.vercel.app/api/categories?company_id=2c3f46cc-fae8-4ef8-99e1-874dec8b2af2');
  const d = await catsRes.json();

  const enOptions = d.map(e => {
    const s = "en" === "en" ? e.name_en : e.name;
    return { id: e.id, label: s };
  });

  const thOptions = d.map(e => {
    const s = "th" === "en" ? e.name_en : e.name;
    return { id: e.id, label: s };
  });

  console.log('Sample EN options in modal:', enOptions.slice(0, 4));
  console.log('Sample TH options in modal:', thOptions.slice(0, 4));
}

run();
