import https from 'https';

https.get('https://www.zoonbooking.uk/admin/chat', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const allMatches = [...data.matchAll(/static\/chunks\/[^"']+\.js/g)].map(m => m[0]);
    const unique = [...new Set(allMatches)];
    console.log('Unique chunk paths:', unique);
  });
});
