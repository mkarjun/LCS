import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { _Object as S3Object } from "@aws-sdk/client-s3";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { BucketPermissionsTab } from "./BucketPermissionsTab";
import { BucketPropertiesTab } from "./BucketPropertiesTab";
import { UploadObjectModal } from "./UploadObjectModal";
import { formatConsoleDate } from "./regions";
import { useS3Client } from "./useS3Client";

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) {
    return "-";
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

/** AWS shows a Type column derived from the key's extension. */
function objectType(key: string | undefined): string {
  if (!key || key.endsWith("/")) {
    return "Folder";
  }
  const lastSegment = key.slice(key.lastIndexOf("/") + 1);
  const dot = lastSegment.lastIndexOf(".");
  return dot > 0 ? lastSegment.slice(dot + 1) : "-";
}

export default function BucketDetailPage() {
  const { bucketName = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const client = useS3Client();
  const { notify } = useNotifications();

  const [objects, setObjects] = useState<S3Object[]>([]);
  const [creationDate, setCreationDate] = useState<Date | undefined>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [selected, setSelected] = useState<S3Object[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  const activeTab = searchParams.get("tab") ?? "objects";

  useBreadcrumbs([
    { text: "Amazon S3", href: "/s3" },
    { text: "Buckets", href: "/s3" },
    { text: bucketName, href: `/s3/buckets/${bucketName}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const listing = await client.send(
        new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1000 }),
      );
      setObjects(listing.Contents ?? []);
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't list objects — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }

    // ListBuckets is the only source of a bucket's creation date.
    try {
      const response = await client.send(new ListBucketsCommand({}));
      setCreationDate(response.Buckets?.find((b) => b.Name === bucketName)?.CreationDate);
    } catch {
      setCreationDate(undefined);
    }
  }, [client, bucketName, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadObject = async (key: string, body: string, contentType: string) => {
    await client.send(
      new PutObjectCommand({ Bucket: bucketName, Key: key, Body: body, ContentType: contentType }),
    );
    notify({ type: "success", content: `Successfully uploaded "${key}".` });
    setUploadOpen(false);
    await load();
  };

  const deleteSelected = async () => {
    const keys = selected.map((object) => object.Key).filter((key): key is string => !!key);
    try {
      await Promise.all(
        keys.map((key) => client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }))),
      );
      notify({
        type: "success",
        content:
          keys.length === 1
            ? `Successfully deleted "${keys[0]}".`
            : `Successfully deleted ${keys.length} objects.`,
      });
      setSelected([]);
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't delete objects — ${title}`, content: detail });
    }
  };

  const copyUri = async () => {
    const key = selected[0]?.Key;
    if (!key) {
      return;
    }
    await navigator.clipboard.writeText(`s3://${bucketName}/${key}`);
    notify({ type: "success", content: "S3 URI copied to clipboard." });
  };

  const copyUrl = async () => {
    const key = selected[0]?.Key;
    if (!key) {
      return;
    }
    await navigator.clipboard.writeText(
      `${window.location.origin}/${bucketName}/${encodeURIComponent(key)}`,
    );
    notify({ type: "success", content: "Object URL copied to clipboard." });
  };

  const download = async () => {
    const key = selected[0]?.Key;
    if (!key) {
      return;
    }
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucketName, Key: key }),
      );
      const body = await response.Body?.transformToByteArray();
      if (!body) {
        return;
      }
      const url = URL.createObjectURL(new Blob([body as BlobPart]));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = key.slice(key.lastIndexOf("/") + 1);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't download object — ${title}`, content: detail });
    }
  };

  const matching = objects.filter((object) =>
    (object.Key ?? "").toLowerCase().startsWith(filterText.trim().toLowerCase()),
  );
  const one = selected.length === 1;

  const objectsTab = (
    <Table
      variant="container"
      loading={loading}
      loadingText="Loading objects"
      items={matching}
      selectionType="multi"
      selectedItems={selected}
      onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
      trackBy={(object) => object.Key ?? ""}
      header={
        <Header
          counter={loading ? undefined : `(${objects.length})`}
          description="Objects are the fundamental entities stored in Amazon S3."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
              <Button disabled={!one} onClick={() => void copyUri()}>
                Copy S3 URI
              </Button>
              <Button disabled={!one} onClick={() => void copyUrl()}>
                Copy URL
              </Button>
              <Button disabled={!one} iconName="download" onClick={() => void download()}>
                Download
              </Button>
              <Button disabled={selected.length === 0} onClick={() => void deleteSelected()}>
                Delete
              </Button>
              <Button variant="primary" iconName="upload" onClick={() => setUploadOpen(true)}>
                Upload
              </Button>
            </SpaceBetween>
          }
        >
          Objects
        </Header>
      }
      columnDefinitions={[
        { id: "key", header: "Name", cell: (object) => object.Key ?? "-", isRowHeader: true },
        { id: "type", header: "Type", cell: (object) => objectType(object.Key) },
        {
          id: "lastModified",
          header: "Last modified",
          cell: (object) => formatConsoleDate(object.LastModified),
        },
        { id: "size", header: "Size", cell: (object) => formatSize(object.Size) },
        {
          id: "storageClass",
          header: "Storage class",
          cell: (object) => object.StorageClass ?? "Standard",
        },
      ]}
      filter={
        <TextFilter
          filteringText={filterText}
          filteringPlaceholder="Find objects by prefix"
          filteringAriaLabel="Find objects by prefix"
          countText={filterText ? `${matching.length} matches` : ""}
          onChange={(event) => setFilterText(event.detail.filteringText)}
        />
      }
      empty={
        failed ? (
          <Box textAlign="center" padding={{ vertical: "l" }}>
            <SpaceBetween size="s">
              <Box variant="strong">Couldn't load objects</Box>
              <Button onClick={() => void load()}>Retry</Button>
            </SpaceBetween>
          </Box>
        ) : filterText ? (
          <Box textAlign="center" padding={{ vertical: "l" }}>
            <SpaceBetween size="s">
              <Box variant="strong">No objects</Box>
              <Button onClick={() => setFilterText("")}>Clear filter</Button>
            </SpaceBetween>
          </Box>
        ) : (
          <Box textAlign="center" padding={{ vertical: "l" }}>
            <SpaceBetween size="s">
              <Box variant="strong">No objects</Box>
              <Box variant="p" color="text-body-secondary">
                You don't have any objects in this bucket.
              </Box>
              <Button iconName="upload" onClick={() => setUploadOpen(true)}>
                Upload
              </Button>
            </SpaceBetween>
          </Box>
        )
      }
    />
  );

  return (
    <ContentLayout header={<Header variant="h1">{bucketName}</Header>}>
      <Tabs
        activeTabId={activeTab}
        onChange={(event) => setSearchParams({ tab: event.detail.activeTabId })}
        tabs={[
          { id: "objects", label: "Objects", content: objectsTab },
          {
            id: "properties",
            label: "Properties",
            content: (
              <BucketPropertiesTab
                client={client}
                bucketName={bucketName}
                creationDate={creationDate}
              />
            ),
          },
          {
            id: "permissions",
            label: "Permissions",
            content: <BucketPermissionsTab client={client} bucketName={bucketName} />,
          },
        ]}
      />

      <UploadObjectModal
        visible={uploadOpen}
        bucketName={bucketName}
        onDismiss={() => setUploadOpen(false)}
        onSubmit={uploadObject}
      />
    </ContentLayout>
  );
}
