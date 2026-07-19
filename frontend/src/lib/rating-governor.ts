// Frequency governor for automatic rating prompts. Without this, a power
// user gets asked on every conclude and every deep discussion — prompt
// fatigue produces resentment and junk ratings.
//
// Rules: at most one automatic prompt per discussion; a submitted rating
// buys 14 days of quiet, a dismissal 3 days. The manual Feedback button is
// never governed.

const QUIET_KEY = "mw_rating_quiet_until";
const PROMPTED_KEY = "mw_rating_prompted"; // JSON array of session ids

const DAY_MS = 24 * 60 * 60 * 1000;

function promptedIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PROMPTED_KEY) || "[]");
  } catch {
    return [];
  }
}

export function shouldAutoPrompt(sessionId: string): boolean {
  if (typeof window === "undefined") return false;
  const quietUntil = Number(localStorage.getItem(QUIET_KEY) || 0);
  if (Date.now() < quietUntil) return false;
  return !promptedIds().includes(sessionId);
}

export function markPrompted(sessionId: string): void {
  const ids = promptedIds();
  if (!ids.includes(sessionId)) {
    // Keep the list from growing forever; old entries are covered by quiet
    // periods anyway.
    localStorage.setItem(PROMPTED_KEY, JSON.stringify([...ids, sessionId].slice(-50)));
  }
}

export function markRated(): void {
  localStorage.setItem(QUIET_KEY, String(Date.now() + 14 * DAY_MS));
}

export function markDismissed(): void {
  localStorage.setItem(QUIET_KEY, String(Date.now() + 3 * DAY_MS));
}
