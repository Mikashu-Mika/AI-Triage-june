// Limits failed password logins, counted separately per client IP and per email.
// Counts live in memory, so they reset when the bot restarts and are not shared between instances.

export const MAX_FAILED_LOGINS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_KEYS = 10000;

/** @type {Map<string, { count: number, firstAt: number }>} */
const failures = new Map();

function keysFor(ip, email) {
  const keys = [];
  if (ip) keys.push(`ip:${ip}`);
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (normalizedEmail) keys.push(`email:${normalizedEmail}`);
  return keys;
}

function activeEntry(key, now) {
  const entry = failures.get(key);
  if (!entry) return null;
  if (now - entry.firstAt >= LOGIN_WINDOW_MS) {
    failures.delete(key);
    return null;
  }
  return entry;
}

/**
 * Seconds the caller must wait before trying again, or 0 when not locked.
 * Locked when either the IP or the email has reached the failure limit inside the window.
 */
export function loginLockSeconds(ip, email, now = Date.now()) {
  let wait = 0;
  for (const key of keysFor(ip, email)) {
    const entry = activeEntry(key, now);
    if (entry && entry.count >= MAX_FAILED_LOGINS) {
      wait = Math.max(wait, Math.ceil((entry.firstAt + LOGIN_WINDOW_MS - now) / 1000));
    }
  }
  return wait;
}

export function recordLoginFailure(ip, email, now = Date.now()) {
  for (const key of keysFor(ip, email)) {
    const entry = activeEntry(key, now);
    if (entry) entry.count += 1;
    else failures.set(key, { count: 1, firstAt: now });
  }
  while (failures.size > MAX_TRACKED_KEYS) {
    failures.delete(failures.keys().next().value);
  }
}

/** Clears the email's count after a successful login. The IP count is kept, so one valid account cannot reset it. */
export function clearLoginFailures(email) {
  for (const key of keysFor(null, email)) failures.delete(key);
}

/** For tests only. */
export function resetLoginLimiter() {
  failures.clear();
}

const sweep = setInterval(() => {
  const now = Date.now();
  for (const key of failures.keys()) activeEntry(key, now);
}, LOGIN_WINDOW_MS);
sweep.unref();
