async function run() {
  const session = {
    id: "admin-01",
    name: "System Admin",
    role: "system_admin",
    company_id: "2c3f46cc-fae8-4ef8-99e1-874dec8b2af2",
    permissions: ["view_dashboard","view_chats","manage_categories","manage_users","manage_companies","export_csv"]
  };
  const cookie = `user_session=${encodeURIComponent(JSON.stringify(session))}; company_id=2c3f46cc-fae8-4ef8-99e1-874dec8b2af2`;

  const res = await fetch('https://ai-triage-eta.vercel.app/chats', {
    headers: {
      'Cookie': cookie,
      'RSC': '1'
    }
  });

  console.log('Status with cookie:', res.status);
  const text = await res.text();
  console.log('RSC text length:', text.length);

  // Look for .js chunk URLs inside this RSC payload!
  const jsChunks = [...text.matchAll(/static\/chunks\/[a-zA-Z0-9_\-\.]+\.js/g)].map(m => m[0]);
  console.log('Chunks found in authenticated /chats:');
  console.log([...new Set(jsChunks)]);
}

run();
