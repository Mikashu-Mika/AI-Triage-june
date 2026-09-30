async function run() {
  // Fetch real data from Vercel's API
  const catsRes = await fetch('https://ai-triage-eta.vercel.app/api/categories?company_id=2c3f46cc-fae8-4ef8-99e1-874dec8b2af2');
  const categories = await catsRes.json();
  console.log('Categories count:', categories.length);
  console.log('Sample category object:', categories[0]);

  const chatsRes = await fetch('https://ai-triage-eta.vercel.app/api/chats?summary_only=true&company_id=2c3f46cc-fae8-4ef8-99e1-874dec8b2af2&nocache=' + Date.now());
  const chats = await chatsRes.json();
  const chat153 = chats.find(c => c.id === 'chat-153');
  console.log('chat-153:', { id: chat153?.id, category_id: chat153?.category_id, chat_issues: chat153?.chat_issues });
}

run();
