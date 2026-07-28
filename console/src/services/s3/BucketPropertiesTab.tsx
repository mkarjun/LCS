import { useCallback, useEffect, useState } from "react";
import {
  GetBucketAccelerateConfigurationCommand,
  GetBucketEncryptionCommand,
  GetBucketLocationCommand,
  GetBucketLoggingCommand,
  GetBucketNotificationConfigurationCommand,
  GetBucketRequestPaymentCommand,
  GetBucketTaggingCommand,
  GetBucketVersioningCommand,
  GetBucketWebsiteCommand,
  GetObjectLockConfigurationCommand,
  PutBucketVersioningCommand,
} from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";

import { describeAwsError } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";
import { formatConsoleDate, formatRegion } from "./regions";

interface BucketPropertiesTabProps {
  client: S3Client;
  bucketName: string;
  creationDate?: Date;
}

interface Properties {
  region: string;
  versioning: string;
  mfaDelete: string;
  encryption: string;
  bucketKey: string;
  tags: { key: string; value: string }[];
  logging: string;
  notifications: number;
  acceleration: string;
  objectLock: string;
  requesterPays: string;
  staticWebsite: string;
}

/**
 * S3 treats "not configured" as an error code rather than an empty response, which is
 * correct AWS behavior. Each lookup therefore resolves to a display value, and an
 * expected not-configured error becomes the AWS default wording instead of a failure.
 */
async function settle<T>(promise: Promise<T>, whenMissing: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return whenMissing;
  }
}

export function BucketPropertiesTab({
  client,
  bucketName,
  creationDate,
}: BucketPropertiesTabProps) {
  const { notify } = useNotifications();
  const [properties, setProperties] = useState<Properties | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingVersioning, setSavingVersioning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      location,
      versioning,
      encryption,
      tagging,
      logging,
      notifications,
      acceleration,
      objectLock,
      requestPayment,
      website,
    ] = await Promise.all([
      settle(client.send(new GetBucketLocationCommand({ Bucket: bucketName })), {} as never),
      settle(client.send(new GetBucketVersioningCommand({ Bucket: bucketName })), {} as never),
      settle(client.send(new GetBucketEncryptionCommand({ Bucket: bucketName })), {} as never),
      settle(client.send(new GetBucketTaggingCommand({ Bucket: bucketName })), {} as never),
      settle(client.send(new GetBucketLoggingCommand({ Bucket: bucketName })), {} as never),
      settle(
        client.send(new GetBucketNotificationConfigurationCommand({ Bucket: bucketName })),
        {} as never,
      ),
      settle(
        client.send(new GetBucketAccelerateConfigurationCommand({ Bucket: bucketName })),
        {} as never,
      ),
      settle(
        client.send(new GetObjectLockConfigurationCommand({ Bucket: bucketName })),
        {} as never,
      ),
      settle(client.send(new GetBucketRequestPaymentCommand({ Bucket: bucketName })), {} as never),
      settle(client.send(new GetBucketWebsiteCommand({ Bucket: bucketName })), {} as never),
    ]);

    const rule = encryption?.ServerSideEncryptionConfiguration?.Rules?.[0];
    const algorithm = rule?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;
    const notificationCount =
      (notifications?.TopicConfigurations?.length ?? 0) +
      (notifications?.QueueConfigurations?.length ?? 0) +
      (notifications?.LambdaFunctionConfigurations?.length ?? 0);

    setProperties({
      region: location?.LocationConstraint ?? "us-east-1",
      versioning: versioning?.Status ?? "Disabled",
      mfaDelete: versioning?.MFADelete ?? "Disabled",
      encryption:
        algorithm === "aws:kms"
          ? "Server-side encryption with AWS KMS keys (SSE-KMS)"
          : algorithm === "AES256"
            ? "Server-side encryption with Amazon S3 managed keys (SSE-S3)"
            : "Not enabled",
      bucketKey: rule?.BucketKeyEnabled ? "Enabled" : "Disabled",
      tags: (tagging?.TagSet ?? []).map((tag: { Key?: string; Value?: string }) => ({
        key: tag.Key ?? "",
        value: tag.Value ?? "",
      })),
      logging: logging?.LoggingEnabled ? "Enabled" : "Disabled",
      notifications: notificationCount,
      acceleration: acceleration?.Status ?? "Disabled",
      objectLock: objectLock?.ObjectLockConfiguration?.ObjectLockEnabled ?? "Disabled",
      requesterPays: requestPayment?.Payer === "Requester" ? "Enabled" : "Disabled",
      staticWebsite: website?.IndexDocument || website?.RedirectAllRequestsTo ? "Enabled" : "Disabled",
    });
    setLoading(false);
  }, [client, bucketName]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleVersioning = async () => {
    if (properties === null) {
      return;
    }
    const next = properties.versioning === "Enabled" ? "Suspended" : "Enabled";
    setSavingVersioning(true);
    try {
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: bucketName,
          VersioningConfiguration: { Status: next },
        }),
      );
      notify({ type: "success", content: `Bucket Versioning ${next.toLowerCase()}.` });
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't update versioning — ${title}`, content: detail });
    } finally {
      setSavingVersioning(false);
    }
  };

  if (loading || properties === null) {
    return (
      <Box textAlign="center" padding={{ vertical: "xxl" }}>
        <Spinner size="large" />
      </Box>
    );
  }

  const setting = (label: string, value: string, description?: string) => (
    <SpaceBetween size="xxs">
      <Box variant="awsui-key-label">{label}</Box>
      {description && (
        <Box variant="small" color="text-body-secondary">
          {description}
        </Box>
      )}
      <Box>{value}</Box>
    </SpaceBetween>
  );

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Bucket overview</Header>}>
        <ColumnLayout columns={3} variant="text-grid">
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">AWS Region</Box>
            <Box>{formatRegion(properties.region)}</Box>
          </SpaceBetween>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Amazon Resource Name (ARN)</Box>
            <Box>arn:aws:s3:::{bucketName}</Box>
          </SpaceBetween>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Creation date</Box>
            <Box>{formatConsoleDate(creationDate)}</Box>
          </SpaceBetween>
        </ColumnLayout>
      </Container>

      <Container
        header={
          <Header
            variant="h2"
            actions={
              <Button loading={savingVersioning} onClick={() => void toggleVersioning()}>
                {properties.versioning === "Enabled" ? "Suspend" : "Enable"}
              </Button>
            }
          >
            Bucket Versioning
          </Header>
        }
      >
        <SpaceBetween size="m">
          <Box variant="small" color="text-body-secondary">
            Versioning is a means of keeping multiple variants of an object in the same bucket.
            You can use versioning to preserve, retrieve, and restore every version of every
            object stored in your bucket.
          </Box>
          {setting("Bucket Versioning", properties.versioning)}
          {setting(
            "Multi-factor authentication (MFA) delete",
            properties.mfaDelete,
            "An additional layer of security that requires multi-factor authentication for changing Bucket Versioning settings and permanently deleting object versions.",
          )}
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Tags ({properties.tags.length})</Header>}>
        <Table
          variant="embedded"
          items={properties.tags}
          trackBy={(tag) => tag.key}
          columnDefinitions={[
            { id: "key", header: "Key", cell: (tag) => tag.key, isRowHeader: true },
            { id: "value", header: "Value", cell: (tag) => tag.value },
          ]}
          empty={
            <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
              No tags associated with this bucket.
            </Box>
          }
        />
      </Container>

      <Container header={<Header variant="h2">Default encryption</Header>}>
        <SpaceBetween size="m">
          <Box variant="small" color="text-body-secondary">
            Server-side encryption is automatically applied to new objects stored in this bucket.
          </Box>
          {setting("Encryption type", properties.encryption)}
          {setting(
            "Bucket Key",
            properties.bucketKey,
            "When KMS encryption is used to encrypt new objects in this bucket, the bucket key reduces encryption costs by lowering calls to AWS KMS.",
          )}
        </SpaceBetween>
      </Container>

      <ColumnLayout columns={2}>
        <Container header={<Header variant="h2">Server access logging</Header>}>
          {setting(
            "Server access logging",
            properties.logging,
            "Log requests for access to your bucket.",
          )}
        </Container>
        <Container header={<Header variant="h2">Event notifications</Header>}>
          {setting(
            "Event notifications",
            String(properties.notifications),
            "Send a notification when specific events occur in your bucket.",
          )}
        </Container>
        <Container header={<Header variant="h2">Transfer acceleration</Header>}>
          {setting(
            "Transfer acceleration",
            properties.acceleration,
            "Use an accelerated endpoint for faster data transfers.",
          )}
        </Container>
        <Container header={<Header variant="h2">Object Lock</Header>}>
          {setting(
            "Object Lock",
            properties.objectLock,
            "Store objects using a write-once-read-many (WORM) model. Object Lock works only in versioned buckets.",
          )}
        </Container>
        <Container header={<Header variant="h2">Requester pays</Header>}>
          {setting(
            "Requester pays",
            properties.requesterPays,
            "When enabled, the requester pays for requests and data transfer costs.",
          )}
        </Container>
        <Container header={<Header variant="h2">Static website hosting</Header>}>
          {setting(
            "Static website hosting",
            properties.staticWebsite,
            "Use this bucket to host a website or redirect requests.",
          )}
        </Container>
      </ColumnLayout>
    </SpaceBetween>
  );
}
