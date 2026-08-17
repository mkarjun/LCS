/**
 * Shared E2E fixtures for the LCS console.
 *
 * Every console route mounts EmulatorProvider, which fetches /_lcs/console/summary on
 * mount (see src/platform/EmulatorContext.tsx). That endpoint is LCS-native, not AWS, so
 * it is stubbed here once rather than in each spec — otherwise every test would depend on
 * a running emulator just to render the shell.
 *
 * Stubbing happens in the browser via page.route(), so requests never reach Vite's proxy
 * to :4566. Anything a spec does NOT stub will hit that proxy and fail loudly, which is
 * intentional: a silent fallback would let a spec pass while talking to nothing.
 */
import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export interface ConsoleSummaryOverrides {
  version?: string;
  defaultRegion?: string;
  defaultAccountId?: string;
  /** Service ids reported enabled. Anything else in the catalog reads as "disabled". */
  enabledServiceIds?: string[];
}

/** Services with a purpose-built console surface, per src/services/registry.ts. */
export const IMPLEMENTED_SERVICE_IDS = [
  "s3",
  "ec2",
  "iam",
  "lambda",
  "logs",
  "monitoring",
  "dynamodb",
  "sqs",
  "sns",
  "rds",
  "cloudformation",
];

export function buildConsoleSummary(overrides: ConsoleSummaryOverrides = {}) {
  const enabled = overrides.enabledServiceIds ?? IMPLEMENTED_SERVICE_IDS;
  return {
    version: overrides.version ?? "0.1.0-e2e",
    edition: "community",
    configuredBaseUrl: "http://localhost:4566",
    defaultRegion: overrides.defaultRegion ?? "us-east-1",
    defaultAccountId: overrides.defaultAccountId ?? "000000000000",
    totalCount: enabled.length,
    runningCount: enabled.length,
    availableCount: enabled.length,
    services: enabled.map((id) => ({
      id,
      configKey: id,
      status: "running" as const,
      enabled: true,
      defaultProtocol: null,
      supportedProtocols: [],
      supportsStorage: false,
      storageMode: null,
      credentialScopes: [],
    })),
  };
}

/** Stubs /_lcs/console/summary. Call before the first navigation. */
export async function stubConsoleSummary(
  page: Page,
  overrides: ConsoleSummaryOverrides = {},
): Promise<void> {
  await page.route("**/_lcs/console/summary", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildConsoleSummary(overrides)),
    });
  });
}

export const test = base.extend<{ consoleSummary: void }>({
  // Auto-applied so every spec gets a shell that renders. A spec needing different
  // summary data unroutes and re-stubs, or calls stubConsoleSummary with overrides.
  consoleSummary: [
    async ({ page }, use) => {
      await stubConsoleSummary(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
