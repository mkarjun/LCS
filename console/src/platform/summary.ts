/**
 * Emulator metadata from the LCS-native console summary endpoint.
 *
 * This is deliberately NOT an AWS API: it reports which services this build has
 * enabled, plus the configured region/account defaults. Everything that models an
 * AWS resource goes through the AWS SDK instead, so this stays a thin catalog.
 */

export interface ConsoleServiceSummary {
  id: string;
  configKey: string;
  status: "running" | "available";
  enabled: boolean;
  defaultProtocol: string | null;
  supportedProtocols: string[];
  supportsStorage: boolean;
  storageMode: string | null;
  credentialScopes: string[];
}

export interface ConsoleSummary {
  version: string;
  edition: string;
  configuredBaseUrl: string;
  defaultRegion: string;
  defaultAccountId: string;
  totalCount: number;
  runningCount: number;
  availableCount: number;
  services: ConsoleServiceSummary[];
}

export async function fetchConsoleSummary(signal?: AbortSignal): Promise<ConsoleSummary> {
  const response = await fetch("/_lcs/console/summary", {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Console summary request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as ConsoleSummary;
}
