import { EC2Client } from "@aws-sdk/client-ec2";
import { useAwsClient } from "@platform/awsClient";

export function useEc2Client(): EC2Client {
  return useAwsClient(EC2Client);
}

/** EC2 tags are a list; the console shows the Name tag as the resource's display name. */
export function tagValue(
  tags: { Key?: string; Value?: string }[] | undefined,
  key: string,
): string | undefined {
  return tags?.find((tag) => tag.Key === key)?.Value;
}

export function nameTag(tags: { Key?: string; Value?: string }[] | undefined): string {
  return tagValue(tags, "Name") ?? "—";
}
