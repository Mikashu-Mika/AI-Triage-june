import fs from 'fs';
import readline from 'readline';
import path from 'path';

async function search() {
  const logDir = 'C:\\Users\\USER\\.gemini\\antigravity\\brain\\72acfc1c-d267-4592-bf90-b146dd7cd9b2\\.system_generated\\logs';
  const transcriptPath = path.join(logDir, 'transcript_full.jsonl');
  
  if (!fs.existsSync(transcriptPath)) {
    console.log('Transcript file not found at:', transcriptPath);
    return;
  }
  
  console.log('Searching transcript for SQL table definitions...');
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  for await (const line of rl) {
    if (line.includes('create table') || line.includes('CREATE TABLE')) {
      // Find lines that look like they contain the sql script
      try {
        const obj = JSON.parse(line);
        const content = obj.content || '';
        if (content.includes('prove_trigger') || content.includes('like_results')) {
          console.log('\n--- Found Matching Step ---');
          console.log(content);
        }
      } catch (e) {
        // Not JSON
      }
    }
  }
  console.log('\nSearch complete.');
}

search();
