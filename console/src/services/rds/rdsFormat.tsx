import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { ReactNode } from "react";

/** AWS renders engine ids with their product capitalisation. */
export function engineLabel(engine: string | undefined): string {
  switch (engine) {
    case "postgres":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "mariadb":
      return "MariaDB";
    default:
      return engine ?? "—";
  }
}

/**
 * DB status badge, matching the AWS console's colouring.
 *
 * LCS reports `available` once the backing container is up and `rebooting` while it
 * restarts; the rest are here because the RDS status vocabulary is shared across
 * instances and clusters and any of them can come back on a slower host.
 */
export function dbStatusIndicator(status: string | undefined): ReactNode {
  switch (status) {
    case "available":
      return <StatusIndicator type="success">Available</StatusIndicator>;
    case "creating":
      return <StatusIndicator type="in-progress">Creating</StatusIndicator>;
    case "modifying":
      return <StatusIndicator type="in-progress">Modifying</StatusIndicator>;
    case "rebooting":
      return <StatusIndicator type="in-progress">Rebooting</StatusIndicator>;
    case "deleting":
      return <StatusIndicator type="in-progress">Deleting</StatusIndicator>;
    case "stopped":
      return <StatusIndicator type="stopped">Stopped</StatusIndicator>;
    case "failed":
      return <StatusIndicator type="error">Failed</StatusIndicator>;
    default:
      return <StatusIndicator type="pending">{status ?? "unknown"}</StatusIndicator>;
  }
}

/**
 * Endpoint as AWS prints it, `host:port`.
 *
 * The address LCS returns is the database container's address on the Docker network.
 * Clients on the host reach the same database on `localhost` at the same port, which is
 * what `endpointHostHint` explains next to it.
 */
export function endpointText(address: string | undefined, port: number | undefined): string {
  if (!address) {
    return "—";
  }
  return port === undefined ? address : `${address}:${port}`;
}

export function formatStorage(gibibytes: number | undefined): string {
  return gibibytes === undefined ? "—" : `${gibibytes} GiB`;
}

/**
 * Cell content for an AWS column LCS has no data for.
 *
 * Dropping these columns would make the table look like AWS's when it is not; filling them
 * with plausible values would be worse. They are rendered greyed, with the reason on the
 * tooltip, and listed in the completeness backlog.
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
