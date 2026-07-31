import { applyMode, Mode } from "@cloudscape-design/global-styles";

/**
 * Visual-mode preference, mirroring AWS's user-settings menu: follow the browser/OS, or
 * pin light or dark. Persisted so it survives a refresh, exactly as the AWS console does.
 */
export type VisualMode = "browser" | "light" | "dark";

const STORAGE_KEY = "lcs.visualMode";
const media = window.matchMedia("(prefers-color-scheme: dark)");

export function getVisualMode(): VisualMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "browser";
}

/** Resolves the preference to a concrete Cloudscape mode and applies it. */
export function applyVisualMode(mode: VisualMode = getVisualMode()): void {
  const dark = mode === "dark" || (mode === "browser" && media.matches);
  applyMode(dark ? Mode.Dark : Mode.Light);
}

export function setVisualMode(mode: VisualMode): void {
  if (mode === "browser") {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, mode);
  }
  applyVisualMode(mode);
}

/**
 * Keeps "browser" mode in step with a live OS theme change. No-op once the user pins a
 * mode. Returns an unsubscribe fn.
 */
export function watchBrowserMode(): () => void {
  const handler = () => {
    if (getVisualMode() === "browser") {
      applyVisualMode("browser");
    }
  };
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}
