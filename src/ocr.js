import { createWorker } from 'tesseract.js';

/**
 * Extract text from an image (supports file path, Buffer, or Base64 data URL).
 * @param {string|Buffer} imageInput - The image to process.
 * @returns {Promise<string>} - The extracted text.
 */
export async function extractTextFromImage(imageInput) {
  if (!imageInput) return '';
  
  console.log('Running OCR text extraction on image...');
  let worker = null;
  try {
    // Initialize worker with Thai and English languages
    worker = await createWorker('tha+eng');
    
    // Perform OCR recognition
    const { data: { text } } = await worker.recognize(imageInput);
    
    console.log('OCR text extraction completed successfully!');
    return text ? text.trim() : '';
  } catch (error) {
    console.error('OCR Extraction failed:', error.message);
    return '';
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
}
