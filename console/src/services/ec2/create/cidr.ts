/**
 * Validates an IPv4 CIDR block the way the AWS console does, before the request is sent.
 *
 * EC2 rejects a bad block with `InvalidParameterValue`, which surfaces as a flashbar well
 * away from the field that caused it, so the check is worth doing in the form.
 */
export function validateIpv4Cidr(
  value: string,
  prefixRange: { min: number; max: number },
): string | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "IPv4 CIDR block is required.";
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(trimmed);
  if (!match) {
    return `"${trimmed}" is not an IPv4 CIDR block. Use a form such as 10.0.0.0/16.`;
  }
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) {
    return `"${trimmed}" is not an IPv4 CIDR block — each octet must be 0-255.`;
  }
  const prefix = Number(match[5]);
  if (prefix < prefixRange.min || prefix > prefixRange.max) {
    return `CIDR block size must be between /${prefixRange.min} and /${prefixRange.max}.`;
  }
  return null;
}
