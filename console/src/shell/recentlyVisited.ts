/**
 * Recently visited services, mirroring the AWS console home widget.
 *
 * Persisted in localStorage because the emulator holds no per-user state — and should
 * not: this is browser preference data, not emulated cloud state.
 */

const STORAGE_KEY = "lcs-console-recently-visited";
const MAX_ENTRIES = 12;

export function readRecentlyVisited(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    // Corrupt or unavailable storage must never break the console.
    return [];
  }
}

export function recordVisit(servicePath: string): void {
  try {
    const existing = readRecentlyVisited().filter((item) => item !== servicePath);
    const next = [servicePath, ...existing].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(RECENTLY_VISITED_EVENT));
  } catch {
    // Ignore — visit history is a convenience, not a requirement.
  }
}

export function clearRecentlyVisited(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(RECENTLY_VISITED_EVENT));
  } catch {
    // Ignore.
  }
}

/** Lets the home widget refresh without prop-drilling through the router. */
export const RECENTLY_VISITED_EVENT = "lcs-recently-visited-changed";
