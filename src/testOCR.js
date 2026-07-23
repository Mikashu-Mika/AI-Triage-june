import { extractTextFromImage } from './ocr.js';
import path from 'path';

async function run() {
  console.log('=== Testing OCR Text Extraction ===');
  
  // Use one of the system screenshot artifacts to test OCR
  const imagePath = 'C:\\Users\\USER\\.gemini\\antigravity\\brain\\72acfc1c-d267-4592-bf90-b146dd7cd9b2\\media__1783582776397.png';
  
  console.log(`Target Image Path: ${imagePath}`);
  
  try {
    const start = Date.now();
    const text = await extractTextFromImage(imagePath);
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    
    console.log('\n================ Extracted Text ================');
    console.log(text || '(No text found)');
    console.log('================================================');
    console.log(`\nOCR completed in ${duration} seconds.`);
    
  } catch (error) {
    console.error('❌ OCR Test failed:', error.message);
  }
}

run();
