/** SNS identifies topics by ARN; the console addresses them by the trailing name. */
export function topicNameFromArn(arn: string): string {
  return arn.slice(arn.lastIndexOf(":") + 1);
}

/** FIFO topics are distinguished by the ".fifo" name suffix, as with SQS. */
export function topicType(arn: string): string {
  return topicNameFromArn(arn).endsWith(".fifo") ? "FIFO" : "Standard";
}

/** Subscription ARNs read "PendingConfirmation" until the endpoint confirms. */
export function subscriptionStatus(subscriptionArn: string | undefined): string {
  if (!subscriptionArn) {
    return "—";
  }
  return subscriptionArn === "PendingConfirmation" ? "Pending confirmation" : "Confirmed";
}

export function dash(value: string | undefined | null): string {
  return value === undefined || value === null || value === "" ? "—" : value;
}
