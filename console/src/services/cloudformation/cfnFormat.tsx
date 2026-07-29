import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { ReactNode } from "react";

/**
 * Stack and resource status badge.
 *
 * CloudFormation statuses are a large, open vocabulary shared by stacks, resources, and
 * change sets, so this classifies by suffix — `_COMPLETE`, `_FAILED`, `_IN_PROGRESS` —
 * rather than listing every value, and prints the raw status as AWS does.
 */
export function cfnStatusIndicator(status: string | undefined): ReactNode {
  if (!status) {
    return <StatusIndicator type="pending">unknown</StatusIndicator>;
  }
  if (status.endsWith("_FAILED") || status.startsWith("ROLLBACK")) {
    return <StatusIndicator type="error">{status}</StatusIndicator>;
  }
  if (status.endsWith("_IN_PROGRESS")) {
    return <StatusIndicator type="in-progress">{status}</StatusIndicator>;
  }
  if (status.endsWith("_COMPLETE")) {
    return <StatusIndicator type="success">{status}</StatusIndicator>;
  }
  return <StatusIndicator type="pending">{status}</StatusIndicator>;
}

export function formatTimestamp(value: Date | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

/**
 * Cell content for an AWS column LCS has no data for. Greyed with the reason on the
 * tooltip, rather than dropped — see shell/navUnavailable for the same idea in the nav.
 */
export function unavailableCell(reason: string): ReactNode {
  return (
    <span
      title={`Not available in LCS — ${reason}`}
      style={{ color: "var(--awsui-color-text-status-inactive, #8c8c94)" }}
    >
      —
    </span>
  );
}

/**
 * The stack name inside a stack ARN.
 *
 * Events and change sets carry the ARN where the console addresses stacks by name.
 */
export function stackNameFromId(stackId: string | undefined): string {
  if (!stackId) {
    return "";
  }
  const parts = stackId.split("/");
  return parts.length >= 2 ? parts[1] : stackId;
}
