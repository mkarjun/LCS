import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetBucketLocationCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { Bucket } from "@aws-sdk/client-s3";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { CreateBucketModal } from "./CreateBucketModal";
import { ConfirmBucketActionModal } from "./ConfirmBucketActionModal";
import { formatConsoleDate, formatRegion } from "./regions";
import { useS3Client } from "./useS3Client";

const PAGE_SIZE = 20;

/** Bucket plus the region resolved from GetBucketLocation, which ListBuckets omits. */
interface BucketRow extends Bucket {
  regionCode?: string;
}

export default function BucketsPage() {
  const navigate = useNavigate();
  const client = useS3Client();
  const { notify } = useNotifications();

  const [buckets, setBuckets] = useState<BucketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState<BucketRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [emptyOpen, setEmptyOpen] = useState(false);

  useBreadcrumbs([
    { text: "Amazon S3", href: "/s3" },
    { text: "Buckets", href: "/s3" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(new ListBucketsCommand({}));
      const listed = response.Buckets ?? [];
      setFailed(false);
      setBuckets(listed);

      // ListBuckets carries no region, so resolve each one. Best-effort and per-bucket:
      // one failure must not blank the whole table.
      const regions = await Promise.all(
        listed.map(async (bucket) => {
          try {
            const location = await client.send(
              new GetBucketLocationCommand({ Bucket: bucket.Name }),
            );
            return location.LocationConstraint ?? "us-east-1";
          } catch {
            return undefined;
          }
        }),
      );
      setBuckets(listed.map((bucket, index) => ({ ...bucket, regionCode: regions[index] })));
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't list buckets — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const createBucket = async (name: string, region: string) => {
    await client.send(
      new CreateBucketCommand({
        Bucket: name,
        // us-east-1 must not carry a location constraint — S3 rejects it.
        ...(region === "us-east-1"
          ? {}
          : { CreateBucketConfiguration: { LocationConstraint: region as never } }),
      }),
    );
    notify({ type: "success", content: `Successfully created bucket "${name}".` });
    setCreateOpen(false);
    setSelected([]);
    await load();
  };

  /** Deletes every object so the bucket can be deleted, matching the console's Empty action. */
  const emptyBucket = async (name: string) => {
    let deleted = 0;
    let continuationToken: string | undefined;
    do {
      const listing = await client.send(
        new ListObjectsV2Command({ Bucket: name, ContinuationToken: continuationToken }),
      );
      const keys = (listing.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => !!key);
      await Promise.all(
        keys.map((key) => client.send(new DeleteObjectCommand({ Bucket: name, Key: key }))),
      );
      deleted += keys.length;
      continuationToken = listing.IsTruncated ? listing.NextContinuationToken : undefined;
    } while (continuationToken);

    notify({
      type: "success",
      content: `Successfully emptied bucket "${name}". Deleted ${deleted} object${deleted === 1 ? "" : "s"}.`,
    });
    setEmptyOpen(false);
    setSelected([]);
    await load();
  };

  const deleteBucket = async (name: string) => {
    await client.send(new DeleteBucketCommand({ Bucket: name }));
    notify({ type: "success", content: `Successfully deleted bucket "${name}".` });
    setDeleteOpen(false);
    setSelected([]);
    await load();
  };

  const copyArn = async () => {
    const name = selected[0]?.Name;
    if (!name) {
      return;
    }
    await navigator.clipboard.writeText(`arn:aws:s3:::${name}`);
    notify({ type: "success", content: `ARN copied to clipboard.` });
  };

  const matching = buckets.filter((bucket) =>
    (bucket.Name ?? "").toLowerCase().includes(filterText.trim().toLowerCase()),
  );
  const pageItems = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const one = selected.length === 1;

  return (
    <ContentLayout header={<Header variant="h1">Buckets</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading buckets"
        items={pageItems}
        selectionType="single"
        selectedItems={selected}
        onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
        trackBy={(bucket) => bucket.Name ?? ""}
        header={
          <Header
            counter={loading ? undefined : `(${buckets.length})`}
            description="Buckets are containers for data stored in S3."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                <Button disabled={!one} iconName="copy" onClick={() => void copyArn()}>
                  Copy ARN
                </Button>
                <Button disabled={!one} onClick={() => setEmptyOpen(true)}>
                  Empty
                </Button>
                <Button disabled={!one} onClick={() => setDeleteOpen(true)}>
                  Delete
                </Button>
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  Create bucket
                </Button>
              </SpaceBetween>
            }
          >
            General purpose buckets
          </Header>
        }
        columnDefinitions={[
          {
            id: "name",
            header: "Name",
            sortingField: "Name",
            isRowHeader: true,
            cell: (bucket) => (
              <Link
                href={`/s3/buckets/${bucket.Name}`}
                onFollow={(event) => {
                  event.preventDefault();
                  navigate(`/s3/buckets/${bucket.Name}`);
                }}
              >
                {bucket.Name}
              </Link>
            ),
          },
          {
            id: "region",
            header: "AWS Region",
            cell: (bucket) => formatRegion(bucket.regionCode),
          },
          {
            id: "creationDate",
            header: "Creation date",
            cell: (bucket) => formatConsoleDate(bucket.CreationDate),
          },
        ]}
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder="Find buckets by name"
            filteringAriaLabel="Find buckets by name"
            countText={filterText ? `${matching.length} matches` : ""}
            onChange={(event) => {
              setFilterText(event.detail.filteringText);
              setCurrentPage(1);
            }}
          />
        }
        pagination={
          <Pagination
            currentPageIndex={currentPage}
            pagesCount={Math.max(1, Math.ceil(matching.length / PAGE_SIZE))}
            onChange={(event) => setCurrentPage(event.detail.currentPageIndex)}
          />
        }
        empty={
          failed ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">Couldn't load buckets</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : filterText ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No buckets</Box>
                <Box variant="p" color="text-body-secondary">
                  No buckets matched your search.
                </Box>
                <Button onClick={() => setFilterText("")}>Clear filter</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No buckets</Box>
                <Box variant="p" color="text-body-secondary">
                  You don't have any buckets.
                </Box>
                <Button onClick={() => setCreateOpen(true)}>Create bucket</Button>
              </SpaceBetween>
            </Box>
          )
        }
      />

      <CreateBucketModal
        visible={createOpen}
        existingNames={buckets.map((bucket) => bucket.Name ?? "")}
        onDismiss={() => setCreateOpen(false)}
        onSubmit={createBucket}
      />
      <ConfirmBucketActionModal
        visible={deleteOpen}
        action="delete"
        bucketName={selected[0]?.Name ?? ""}
        onDismiss={() => setDeleteOpen(false)}
        onSubmit={deleteBucket}
      />
      <ConfirmBucketActionModal
        visible={emptyOpen}
        action="empty"
        bucketName={selected[0]?.Name ?? ""}
        onDismiss={() => setEmptyOpen(false)}
        onSubmit={emptyBucket}
      />
    </ContentLayout>
  );
}
