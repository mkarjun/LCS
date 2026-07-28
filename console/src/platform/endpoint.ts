/**
 * Endpoint and credential resolution for the LCS console.
 *
 * The console is always same-origin with the emulator: in production it is served
 * by LCS itself, and in dev Vite proxies emulator traffic. So the endpoint is simply
 * the page origin and no CORS handling is required on either path.
 *
 * Credentials are intentionally non-secret. LCS accepts any non-empty values, and a
 * 12-digit access key id selects the account for multi-account isolation.
 */

const ACCESS_KEY_STORAGE_KEY = "lcs-console-access-key";

export const DEFAULT_ACCESS_KEY_ID = "test";
export const DEFAULT_SECRET_ACCESS_KEY = "test";

export function resolveEndpoint(): string {
  return window.location.origin;
}

/**
 * The access key doubles as the account selector: LCS treats an exactly-12-digit
 * key as the account id and isolates resources by it. Persisted so an account
 * choice survives reloads.
 */
export function resolveAccessKeyId(): string {
  return window.localStorage.getItem(ACCESS_KEY_STORAGE_KEY) ?? DEFAULT_ACCESS_KEY_ID;
}

export function setAccessKeyId(accessKeyId: string): void {
  const next = accessKeyId.trim();
  if (next === "" || next === DEFAULT_ACCESS_KEY_ID) {
    window.localStorage.removeItem(ACCESS_KEY_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(ACCESS_KEY_STORAGE_KEY, next);
}

export function resolveCredentials() {
  return {
    accessKeyId: resolveAccessKeyId(),
    secretAccessKey: DEFAULT_SECRET_ACCESS_KEY,
  };
}
