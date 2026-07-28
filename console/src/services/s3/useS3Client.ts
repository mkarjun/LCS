import { S3Client } from "@aws-sdk/client-s3";
import { useAwsClient } from "@platform/awsClient";

/**
 * S3 client for the console.
 *
 * `forcePathStyle` is required: virtual-host style would put the bucket in the
 * Host header (`bucket.localhost:4566`), which the browser cannot resolve for an
 * arbitrary bucket name.
 */
export function useS3Client(): S3Client {
  return useAwsClient(S3Client, { forcePathStyle: true });
}
