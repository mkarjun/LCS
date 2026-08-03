/**
 * LCS-native CloudShell control plane (`/_lcs/cloudshell/*`).
 *
 * Not an AWS API, so it is plain fetch rather than an AWS SDK client. It answers the one
 * question the terminal has to settle before opening a socket — is a real shell available,
 * and if not, why — and drives the session actions in AWS's Actions menu.
 */

const BASE = "/_lcs/cloudshell";

export interface CloudShellSessionSummary {
  id: string;
  region: string;
  accountId: string;
  containerName: string;
  image: string;
  usingFallbackImage: boolean;
  homeVolume: string;
  createdAt: string;
  lastActivity: string;
  attachedTerminals: number;
}

export interface CloudShellStatus {
  enabled: boolean;
  /** True only when a real terminal can be served right now. */
  available: boolean;
  /** Why not, when `available` is false. Written for the person at the console. */
  reason: string | null;
  image: string;
  fallbackImage: string;
  homeDirectory: string;
  idleTimeoutSeconds: number;
  sessionTimeoutSeconds: number;
  maxSessions: number;
  sessions: CloudShellSessionSummary[];
}

/**
 * Status of the CloudShell backend.
 *
 * A published LCS image predating the gateway has no such endpoint and returns the
 * console's own index.html for it, so a non-JSON or failed response is reported as "not
 * available" rather than thrown — the terminal falls back to its preview shell.
 */
export async function fetchStatus(): Promise<CloudShellStatus> {
  const unavailable = (reason: string): CloudShellStatus => ({
    enabled: false,
    available: false,
    reason,
    image: "",
    fallbackImage: "",
    homeDirectory: "~",
    idleTimeoutSeconds: 0,
    sessionTimeoutSeconds: 0,
    maxSessions: 0,
    sessions: [],
  });

  try {
    const response = await fetch(`${BASE}/status`, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      return unavailable("This LCS build does not serve the CloudShell backend.");
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return unavailable("This LCS build does not serve the CloudShell backend.");
    }
    return (await response.json()) as CloudShellStatus;
  } catch {
    return unavailable("Could not reach LCS to check whether CloudShell is available.");
  }
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function restartSession(sessionId: string, region: string, account: string): Promise<void> {
  const query = new URLSearchParams({ region, account });
  const response = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}/restart?${query}`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not restart the session."));
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not delete the session."));
  }
}

/** Uploads one file into the session's home directory. Returns its path in the container. */
export async function uploadFile(sessionId: string, file: File): Promise<string> {
  const query = new URLSearchParams({ name: file.name });
  const response = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}/files?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: await file.arrayBuffer(),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Upload failed."));
  }
  const body = (await response.json()) as { path: string };
  return body.path;
}

/** Downloads a container path and hands it to the browser as a file. */
export async function downloadFile(sessionId: string, path: string): Promise<void> {
  const query = new URLSearchParams({ path });
  const response = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}/files?${query}`);
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Download failed."));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = path.slice(path.lastIndexOf("/") + 1) || "download";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
