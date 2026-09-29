import { getCategories } from '../src/supabase.js';
import { getEmbedding } from '../src/ollama.js';

function cosineSim(a, b) {
  let dot = 0, mA = 0, mB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    mA += a[i] * a[i];
    mB += b[i] * b[i];
  }
  return dot / (Math.sqrt(mA) * Math.sqrt(mB));
}

async function test() {
  const cats = await getCategories('2c3f46cc-fae8-4ef8-99e1-874dec8b2af2');
  console.log(`Categories loaded: ${cats.length}`);

  const testSentences = [
    'ยอดเงินโอนแล้วไม่เข้าบัญชีเลยครับ',
    'ปุ่มกดสั่งซื้อไม่ตอบสนอง ค้างเป็นสีเทา',
    'เข้าหน้าเว็บไม่ได้ขึ้น Error 502 Bad Gateway',
    'มีคนพยายามแฮกบัญชีเข้ามาจากต่างประเทศ'
  ];

  for (const text of testSentences) {
    const vec = await getEmbedding(text);
    const scores = cats.map(c => {
      const cVec = typeof c.embedding === 'string' ? JSON.parse(c.embedding) : c.embedding;
      return { id: c.id, name: c.name, sim: cVec ? cosineSim(vec, cVec) : 0 };
    }).sort((a, b) => b.sim - a.sim);

    console.log(`\nข้อความ: "${text}"`);
    console.log(`  -> ตรงกับหมวด: "${scores[0].name}" (${scores[0].id}) ความเหมือน: ${(scores[0].sim * 100).toFixed(1)}%`);
    console.log(`  -> อันดับ 2:   "${scores[1].name}" (${scores[1].id}) ความเหมือน: ${(scores[1].sim * 100).toFixed(1)}%`);
  }
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
