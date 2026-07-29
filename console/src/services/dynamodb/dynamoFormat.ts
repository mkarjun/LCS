import type { AttributeValue, TableDescription } from "@aws-sdk/client-dynamodb";

/** "orderId (String)" — the form the DynamoDB console uses for key columns. */
export function keySchemaSummary(table: TableDescription, keyType: "HASH" | "RANGE"): string {
  const element = (table.KeySchema ?? []).find((key) => key.KeyType === keyType);
  if (!element?.AttributeName) {
    return "—";
  }
  const definition = (table.AttributeDefinitions ?? []).find(
    (attribute) => attribute.AttributeName === element.AttributeName,
  );
  const typeNames: Record<string, string> = { S: "String", N: "Number", B: "Binary" };
  const typeName = typeNames[definition?.AttributeType ?? ""] ?? definition?.AttributeType ?? "";
  return typeName ? `${element.AttributeName} (${typeName})` : element.AttributeName;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Renders a DynamoDB attribute value for a table cell.
 *
 * Items are heterogeneous — every attribute is a typed union — so this flattens the
 * wire shape to something displayable without losing the type distinction that makes
 * DynamoDB items readable.
 */
export function renderAttribute(value: AttributeValue | undefined): string {
  if (value === undefined) {
    return "";
  }
  if (value.S !== undefined) {
    return value.S;
  }
  if (value.N !== undefined) {
    return value.N;
  }
  if (value.BOOL !== undefined) {
    return String(value.BOOL);
  }
  if (value.NULL) {
    return "null";
  }
  if (value.SS !== undefined) {
    return `[${value.SS.join(", ")}]`;
  }
  if (value.NS !== undefined) {
    return `[${value.NS.join(", ")}]`;
  }
  if (value.L !== undefined) {
    return `[${value.L.map((item) => renderAttribute(item)).join(", ")}]`;
  }
  if (value.M !== undefined) {
    return `{${Object.entries(value.M)
      .map(([key, entry]) => `${key}=${renderAttribute(entry)}`)
      .join(", ")}}`;
  }
  if (value.B !== undefined) {
    return "<binary>";
  }
  return "";
}

/** Column set for an item table: union of every attribute present, keys first. */
export function itemColumns(
  items: Record<string, AttributeValue>[],
  table: TableDescription | null,
): string[] {
  const keyNames = (table?.KeySchema ?? [])
    .map((key) => key.AttributeName)
    .filter((name): name is string => !!name);
  const others = new Set<string>();
  for (const item of items) {
    for (const name of Object.keys(item)) {
      if (!keyNames.includes(name)) {
        others.add(name);
      }
    }
  }
  return [...keyNames, ...[...others].sort()];
}
