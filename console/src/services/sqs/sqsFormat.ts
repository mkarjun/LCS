/**
 * SQS identifies queues by URL, but the console addresses them by name. The name is the
 * last path segment of the queue URL.
 */
export function queueNameFromUrl(queueUrl: string): string {
  return queueUrl.slice(queueUrl.lastIndexOf("/") + 1);
}

/** FIFO queues are distinguished purely by the ".fifo" name suffix. */
export function queueType(queueUrl: string): string {
  return queueNameFromUrl(queueUrl).endsWith(".fifo") ? "FIFO" : "Standard";
}

/** SQS returns timestamps as epoch-second strings. */
export function formatSqsTimestamp(seconds: string | undefined): string {
  if (!seconds) {
    return "—";
  }
  const parsed = Number.parseInt(seconds, 10);
  return Number.isNaN(parsed) ? "—" : new Date(parsed * 1000).toLocaleString();
}

/** Retention and visibility come back as second counts; AWS shows them humanised. */
export function formatSeconds(value: string | undefined): string {
  if (!value) {
    return "—";
  }
  const seconds = Number.parseInt(value, 10);
  if (Number.isNaN(seconds)) {
    return "—";
  }
  if (seconds < 60) {
    return `${seconds} seconds`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} minutes`;
  }
  if (seconds < 86400) {
    return `${Math.round(seconds / 3600)} hours`;
  }
  return `${Math.round(seconds / 86400)} days`;
}

export function formatKb(bytes: string | undefined): string {
  if (!bytes) {
    return "—";
  }
  const parsed = Number.parseInt(bytes, 10);
  return Number.isNaN(parsed) ? "—" : `${Math.round(parsed / 1024)} KB`;
}
