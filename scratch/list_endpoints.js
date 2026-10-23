import fs from 'fs';

const content = fs.readFileSync('src/index.js', 'utf8');
const lines = content.split('\n');

lines.forEach((l, idx) => {
  if (l.includes('app.get(') || l.includes('app.post(') || l.includes('app.put(') || l.includes('app.delete(') || l.includes('app.patch(')) {
    console.log(`Line ${idx + 1}: ${l.trim()}`);
  }
});
