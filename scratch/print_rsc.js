async function run() {
  const res = await fetch('https://ai-triage-eta.vercel.app/chats', {
    headers: {
      'RSC': '1'
    }
  });

  const text = await res.text();
  console.log(text);
}

run();
