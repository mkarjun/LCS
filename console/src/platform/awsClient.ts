import { useMemo } from "react";
import { useEmulator } from "./EmulatorContext";
import { resolveCredentials, resolveEndpoint } from "./endpoint";

/**
 * Shared config every AWS SDK client in the console is built from.
 *
 * Service modules construct their own clients with this so there is exactly one
 * place that knows how the console reaches the emulator.
 */
export interface AwsClientConfig {
  endpoint: string;
  region: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
}

type ClientConstructor<T> = new (config: AwsClientConfig & Record<string, unknown>) => T;

/**
 * Builds an AWS SDK client bound to the current region and account selection.
 *
 * `extraConfig` covers per-service needs such as S3's `forcePathStyle`.
 */
export function useAwsClient<T>(
  Client: ClientConstructor<T>,
  extraConfig: Record<string, unknown> = {},
): T {
  const { region, accessKeyId } = useEmulator();
  const extraConfigKey = JSON.stringify(extraConfig);

  return useMemo(
    () =>
      new Client({
        endpoint: resolveEndpoint(),
        region,
        credentials: resolveCredentials(),
        ...extraConfig,
      }),
    // extraConfig is compared by value so callers can pass an inline object literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Client, region, accessKeyId, extraConfigKey],
  );
}

interface AwsErrorShape {
  name?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number };
}

/**
 * Turns an AWS SDK error into console-facing text.
 *
 * AWS error names are kept verbatim — they are the same strings the CLI and SDKs
 * surface, so matching them keeps the console honest about what the API returned.
 */
export function describeAwsError(cause: unknown): { title: string; detail: string } {
  if (typeof cause === "object" && cause !== null) {
    const error = cause as AwsErrorShape;
    const status = error.$metadata?.httpStatusCode;
    const title = error.name ?? "RequestFailed";
    const detail = error.message ?? "The emulator returned an error with no message.";
    return { title: status ? `${title} (HTTP ${status})` : title, detail };
  }
  return { title: "RequestFailed", detail: String(cause) };
}
