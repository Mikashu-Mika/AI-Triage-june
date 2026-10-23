/**
 * AI Scheduler & Priority Queue Controller
 * 
 * Manages resource allocation for local Ollama models (Qwen 2.5 & BGE-M3).
 * Enforces strict priority hierarchy:
 * - Priority 1 (High): Telegram Executive & Interactive queries (ผู้บริหารกลุ่ม Telegram)
 * - Priority 2 (Normal): Background Triage chats (real-time ingestion, auto-scanner, batch)
 * 
 * Rules:
 * 1. When an executive or Telegram question arrives, background triage immediately pauses/yields.
 * 2. All GPU/CPU resources are dedicated to answering the executive first.
 * 3. Once all Telegram queries finish, background triage resumes automatically.
 */

let interactiveWaitingCount = 0;
let executiveWaitingCount = 0;
let lastExecutiveSender = null;
let lastActiveTimestamp = null;
const resumeBackgroundResolvers = [];

// Reference to triage queue state (injected from index.js)
let getTriageQueueStateFn = null;

export function setTriageQueueStateGetter(fn) {
  getTriageQueueStateFn = fn;
}

/**
 * Register the arrival of a high-priority interactive query (Telegram).
 * Immediately pauses background triage queue.
 */
export function registerInteractiveStart(source = 'Telegram', isExecutive = false, senderName = 'Executive') {
  interactiveWaitingCount++;
  lastActiveTimestamp = new Date().toISOString();
  if (isExecutive) {
    executiveWaitingCount++;
    lastExecutiveSender = senderName;
    console.log(`👑 [Priority Controller] EXECUTIVE QUERY STARTED by ${senderName} (${source}). Total interactive waiting: ${interactiveWaitingCount} -> Background Triage PAUSED.`);
  } else {
    console.log(`⚡ [Priority Controller] High-priority task started (${source}). Total interactive waiting: ${interactiveWaitingCount} -> Background Triage PAUSED.`);
  }
}

/**
 * Register the completion of an interactive query.
 * Resumes background triage once all interactive queries are finished.
 */
export function registerInteractiveEnd(source = 'Telegram', isExecutive = false) {
  interactiveWaitingCount = Math.max(0, interactiveWaitingCount - 1);
  if (isExecutive) {
    executiveWaitingCount = Math.max(0, executiveWaitingCount - 1);
  }
  lastActiveTimestamp = new Date().toISOString();

  console.log(`⚡ [Priority Controller] High-priority task finished (${source}${isExecutive ? ' [Executive]' : ''}). Remaining interactive: ${interactiveWaitingCount}`);

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
 * Check if an executive query is currently active.
 * @returns {boolean}
 */
export function isExecutiveActive() {
  return executiveWaitingCount > 0;
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

  const roleText = executiveWaitingCount > 0 ? `👑 Executive (${lastExecutiveSender || 'ผู้บริหาร'})` : '⚡ Telegram';
  console.log(`⏸️ [Priority Controller] ${taskId} yielding to ${roleText} (${interactiveWaitingCount} active/waiting)...`);
  return new Promise((resolve) => {
    resumeBackgroundResolvers.push(resolve);
  });
}

/**
 * Get comprehensive real-time metrics for monitoring dashboard and testers.
 */
export function getQueueMetrics() {
  const triageState = getTriageQueueStateFn ? getTriageQueueStateFn() : { queueLength: 0, currentChatId: null, isProcessing: false };

  let systemState = 'IDLE';
  if (executiveWaitingCount > 0) {
    systemState = 'EXECUTIVE_ACTIVE';
  } else if (interactiveWaitingCount > 0) {
    systemState = 'TELEGRAM_ACTIVE';
  } else if (triageState.isProcessing) {
    systemState = 'TRIAGE_RUNNING';
  }

  let triageStatus = 'IDLE';
  if (interactiveWaitingCount > 0) {
    triageStatus = 'PAUSED_FOR_TELEGRAM';
  } else if (triageState.isProcessing) {
    triageStatus = 'PROCESSING';
  }

  return {
    systemState,
    triageStatus,
    isInteractiveActive: interactiveWaitingCount > 0,
    interactiveWaitingCount,
    isExecutiveActive: executiveWaitingCount > 0,
    executiveWaitingCount,
    lastExecutiveSender,
    lastActiveTimestamp,
    triageQueueLength: triageState.queueLength,
    currentProcessingChatId: triageState.currentChatId,
    waitingBackgroundCount: resumeBackgroundResolvers.length
  };
}
