/**
 * Log group and stream names contain slashes ("/aws/lambda/my-fn"), which cannot go into
 * a path segment as-is. They are encoded once for the URL and decoded on the way back.
 *
 * `encodeURIComponent` alone is not enough: the router decodes `%2F` before the component
 * sees it, so the slash would reappear and split the route. Encoding the percent sign
 * itself survives that round trip.
 */
export function encodeLogName(name: string): string {
  return encodeURIComponent(name).replace(/%/g, "$");
}

export function decodeLogName(encoded: string): string {
  return decodeURIComponent(encoded.replace(/\$/g, "%"));
}

/** AWS shows log timestamps in the "2025-11-14T07:18:17.583Z" form. */
export function formatEventTimestamp(millis: number | undefined): string {
  if (millis === undefined) {
    return "—";
  }
  return new Date(millis).toISOString();
}

export function formatDateTime(millis: number | undefined): string {
  if (millis === undefined) {
    return "—";
  }
  return new Date(millis).toLocaleString();
}

/** Stored bytes read as "50.6 KB" in the AWS log group details panel. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** AWS renders an unset retention as "Never expire". */
export function formatRetention(days: number | undefined): string {
  if (days === undefined || days === null) {
    return "Never expire";
  }
  return days === 1 ? "1 day" : `${days} days`;
}

export function dash(value: string | number | undefined | null): string {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}
