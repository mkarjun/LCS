import { IAMClient } from "@aws-sdk/client-iam";
import { useAwsClient } from "@platform/awsClient";

/**
 * IAM client.
 *
 * IAM is a global service — AWS always signs it against us-east-1 regardless of the
 * console's selected region — but LCS accepts any region, so the shared region is used
 * rather than forcing one. Resources are account-scoped, not region-scoped.
 */
export function useIamClient(): IAMClient {
  return useAwsClient(IAMClient);
}

/** AWS renders unset IAM fields as an em dash. */
export function dash(input: string | number | undefined | null): string {
  return input === undefined || input === null || input === "" ? "—" : String(input);
}

/** IAM timestamps in the console read as "March 4, 2026, 12:18 (UTC+05:30)". */
export function formatIamDate(value: Date | undefined): string {
  if (!value) {
    return "—";
  }
  return value.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * AWS shows role trust in the Roles table as the trusted principals, parsed out of the
 * assume-role policy document. The document arrives URL-encoded.
 */
export function trustedEntities(assumeRolePolicyDocument: string | undefined): string {
  if (!assumeRolePolicyDocument) {
    return "—";
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(assumeRolePolicyDocument)) as {
      Statement?: { Principal?: Record<string, string | string[]> }[];
    };
    const principals = (parsed.Statement ?? []).flatMap((statement) =>
      Object.entries(statement.Principal ?? {}).flatMap(([type, value]) => {
        const values = Array.isArray(value) ? value : [value];
        return values.map((entry) => (type === "Service" ? entry : `${type}: ${entry}`));
      }),
    );
    return principals.length > 0 ? [...new Set(principals)].join(", ") : "—";
  } catch {
    return "—";
  }
}

/** Policy documents come URL-encoded; the console shows them pretty-printed. */
export function formatPolicyDocument(document: string | undefined): string {
  if (!document) {
    return "";
  }
  try {
    return JSON.stringify(JSON.parse(decodeURIComponent(document)), null, 2);
  } catch {
    return document;
  }
}
