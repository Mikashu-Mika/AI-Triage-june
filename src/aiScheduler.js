/**
 * AI Scheduler & Priority Queue Controller
 * 
 * Manages resource allocation for local Ollama models (Qwen 2.5 & BGE-M3).
 * Enforces strict priority hierarchy:
 * - Priority 1 (High): Telegram group questions & interactive agent queries
 * - Priority 2 (Normal): Background Triage chats (real-time ingestion, auto-scanner, batch)
 * 
 * Rules:
 * 1. When a Telegram question arrives, background triage immediately pauses/yields.
 * 2. All GPU/CPU resources are dedicated to answering Telegram first.
 * 3. Once all Telegram queries finish, background triage resumes automatically.
 */

let interactiveWaitingCount = 0;
const resumeBackgroundResolvers = [];

/**
 * Register the arrival of a high-priority interactive query (Telegram).
 * Immediately pauses background triage queue.
 */
export function registerInteractiveStart(source = 'Telegram') {
  interactiveWaitingCount++;
  console.log(`⚡ [Priority Controller] High-priority task started (${source}). Active/Waiting: ${interactiveWaitingCount} -> Background Triage PAUSED.`);
}

/**
 * Register the completion of an interactive query.
 * Resumes background triage once all interactive queries are finished.
 */
export function registerInteractiveEnd(source = 'Telegram') {
  interactiveWaitingCount = Math.max(0, interactiveWaitingCount - 1);
  console.log(`⚡ [Priority Controller] High-priority task finished (${source}). Remaining: ${interactiveWaitingCount}`);

  if (interactiveWaitingCount === 0) {
    if (resumeBackgroundResolvers.length > 0) {
      console.log(`▶️ [Priority Controller] All interactive tasks complete. Resuming ${resumeBackgroundResolvers.length} waiting background triage task(s).`);
      while (resumeBackgroundResolvers.length > 0) {
        const resolve = resumeBackgroundResolvers.shift();
        try {
          resolve();
        } catch (e) {
          console.error('[Priority Controller] Error resolving background task:', e);
        }
      }
    } else {
      console.log(`▶️ [Priority Controller] All interactive tasks complete. Background triage idle.`);
    }
  }
}

/**
 * Check if any interactive (Telegram) queries are currently active or queued.
 * @returns {boolean}
 */
export function isInteractiveActive() {
  return interactiveWaitingCount > 0;
}

/**
 * Get current interactive task count.
 * @returns {number}
 */
export function getInteractiveCount() {
  return interactiveWaitingCount;
}

/**
 * Called by background triage tasks before using Ollama.
 * If Telegram is active or waiting, this will pause execution until Telegram is finished.
 * @param {string} taskId Identifier for logging
 * @returns {Promise<void>}
 */
export async function waitForInteractiveIdle(taskId = 'Background Triage') {
  if (interactiveWaitingCount === 0) {
    return; // Ollama is free for background work
  }

  console.log(`⏸️ [Priority Controller] ${taskId} yielding to Telegram (${interactiveWaitingCount} active/waiting)...`);
  return new Promise((resolve) => {
    resumeBackgroundResolvers.push(resolve);
  });
}
