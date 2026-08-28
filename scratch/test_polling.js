import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

const TOKEN = '8365412791:AAHV3NAn6vuSF5u2G2qVOSktVtFqeZx15cc';

function getUpdates() {
  const url = `https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=10`;
  https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        console.log('--- TELEGRAM UPDATES ---');
        console.log(JSON.stringify(json, null, 2));
      } catch (e) {
        console.error('JSON Error:', e.message);
      }
    });
  });
}

getUpdates();
