import { useCallback, useEffect, useState } from "react";
import {
  GetBucketPolicyCommand,
  GetPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";

import { useNotifications } from "@shell/NotificationContext";

interface BucketPermissionsTabProps {
  client: S3Client;
  bucketName: string;
}

/** Pretty-prints the policy, falling back to the raw string if it is not valid JSON. */
function formatPolicy(policy: string): string {
  try {
    return JSON.stringify(JSON.parse(policy), null, 2);
  } catch {
    return policy;
  }
}

interface PublicAccessBlock {
  BlockPublicAcls?: boolean;
  IgnorePublicAcls?: boolean;
  BlockPublicPolicy?: boolean;
  RestrictPublicBuckets?: boolean;
}

export function BucketPermissionsTab({ client, bucketName }: BucketPermissionsTabProps) {
  const { notify } = useNotifications();
  const [policy, setPolicy] = useState<string | null>(null);
  const [access, setAccess] = useState<PublicAccessBlock | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    // Both lookups return an error code when unset — that is normal S3 behavior and means
    // "not configured", not a failure.
    try {
      const response = await client.send(new GetBucketPolicyCommand({ Bucket: bucketName }));
      setPolicy(response.Policy ?? null);
    } catch {
      setPolicy(null);
    }

    try {
      const response = await client.send(new GetPublicAccessBlockCommand({ Bucket: bucketName }));
      setAccess(response.PublicAccessBlockConfiguration ?? null);
    } catch {
      setAccess(null);
    }

    setLoading(false);
  }, [client, bucketName]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Box textAlign="center" padding={{ vertical: "xxl" }}>
        <Spinner size="large" />
      </Box>
    );
  }

  const blockAll =
    access?.BlockPublicAcls === true &&
    access?.IgnorePublicAcls === true &&
    access?.BlockPublicPolicy === true &&
    access?.RestrictPublicBuckets === true;

  const flag = (label: string, value: boolean | undefined) => (
    <SpaceBetween size="xxs">
      <Box variant="awsui-key-label">{label}</Box>
      <Box>{value === true ? "On" : "Off"}</Box>
    </SpaceBetween>
  );

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Block public access (bucket settings)</Header>}>
        <SpaceBetween size="m">
          <Box variant="small" color="text-body-secondary">
            Public access is granted to buckets and objects through access control lists (ACLs),
            bucket policies, access point policies, or all. To ensure that public access to this
            bucket and its objects is blocked, turn on Block all public access.
          </Box>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Block all public access</Box>
            {blockAll ? (
              <StatusIndicator type="success">On</StatusIndicator>
            ) : (
              <StatusIndicator type="warning">Off</StatusIndicator>
            )}
          </SpaceBetween>
          <ColumnLayout columns={4} variant="text-grid">
            {flag("Block public ACLs", access?.BlockPublicAcls)}
            {flag("Ignore public ACLs", access?.IgnorePublicAcls)}
            {flag("Block public bucket policies", access?.BlockPublicPolicy)}
            {flag("Restrict public buckets", access?.RestrictPublicBuckets)}
          </ColumnLayout>
        </SpaceBetween>
      </Container>

      <Container
        header={
          <Header
            variant="h2"
            actions={
              <Button
                disabled={policy === null}
                iconName="copy"
                onClick={() => {
                  if (policy !== null) {
                    void navigator.clipboard.writeText(policy);
                    notify({ type: "success", content: "Bucket policy copied to clipboard." });
                  }
                }}
              >
                Copy
              </Button>
            }
          >
            Bucket policy
          </Header>
        }
      >
        <SpaceBetween size="m">
          <Box variant="small" color="text-body-secondary">
            The bucket policy, written in JSON, provides access to the objects stored in the
            bucket. Bucket policies don't apply to objects owned by other accounts.
          </Box>
          {policy === null ? (
            <>
              {blockAll && (
                <Alert type="info">
                  Public access is blocked because Block Public Access settings are turned on for
                  this bucket.
                </Alert>
              )}
              <Box color="text-body-secondary">No policy to display.</Box>
            </>
          ) : (
            <Box variant="code" display="block">
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowX: "auto" }}>
                {formatPolicy(policy)}
              </pre>
            </Box>
          )}
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}
