import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { ReactNode } from "react";

/**
 * Instance-state badge, matching the AWS console's colouring.
 *
 * AWS shows running as a green success tick, stopped as a red stopped marker, and the
 * transitional states (pending, stopping, shutting-down) as in-progress.
 */
export function instanceStateIndicator(state: string | undefined): ReactNode {
  switch (state) {
    case "running":
      return <StatusIndicator type="success">Running</StatusIndicator>;
    case "stopped":
      return <StatusIndicator type="stopped">Stopped</StatusIndicator>;
    case "terminated":
      return <StatusIndicator type="error">Terminated</StatusIndicator>;
    case "pending":
      return <StatusIndicator type="in-progress">Pending</StatusIndicator>;
    case "stopping":
      return <StatusIndicator type="in-progress">Stopping</StatusIndicator>;
    case "shutting-down":
      return <StatusIndicator type="in-progress">Shutting down</StatusIndicator>;
    default:
      return <StatusIndicator type="pending">{state ?? "unknown"}</StatusIndicator>;
  }
}
