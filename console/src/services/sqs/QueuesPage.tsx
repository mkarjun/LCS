import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ListQueuesCommand,
  PurgeQueueCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { CreateQueueModal } from "./CreateQueueModal";
import { formatSqsTimestamp, queueNameFromUrl, queueType } from "./sqsFormat";

interface QueueRow {
  url: string;
  name: string;
  type: string;
  created?: string;
  available?: string;
  inFlight?: string;
}

export default function QueuesPage() {
  const navigate = useNavigate();
  const client = useAwsClient(SQSClient);
  const { notify } = useNotifications();

  const [queues, setQueues] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [selected, setSelected] = useState<QueueRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  useBreadcrumbs([
    { text: "Amazon SQS", href: "/sqs" },
    { text: "Queues", href: "/sqs" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const urls = (await client.send(new ListQueuesCommand({}))).QueueUrls ?? [];
      // ListQueues returns URLs only; message counts come from GetQueueAttributes.
      const rows = await Promise.all(
        urls.map(async (url): Promise<QueueRow> => {
          const base: QueueRow = { url, name: queueNameFromUrl(url), type: queueType(url) };
          try {
            const attributes = (
              await client.send(
                new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["All"] }),
              )
            ).Attributes;
            return {
              ...base,
              created: attributes?.CreatedTimestamp,
              available: attributes?.ApproximateNumberOfMessages,
              inFlight: attributes?.ApproximateNumberOfMessagesNotVisible,
            };
          } catch {
            return base;
          }
        }),
      );
      setQueues(rows);
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load queues — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const runOnSelected = async (
    action: "delete" | "purge",
  ) => {
    try {
      await Promise.all(
        selected.map((queue) =>
          action === "delete"
            ? client.send(new DeleteQueueCommand({ QueueUrl: queue.url }))
            : client.send(new PurgeQueueCommand({ QueueUrl: queue.url })),
        ),
      );
      notify({
        type: "success",
        content:
          action === "delete"
            ? `Deleted ${selected.length} queue(s).`
            : `Purged ${selected.length} queue(s).`,
      });
      setSelected([]);
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't ${action} queue — ${title}`, content: detail });
    }
  };

  const query = filterText.trim().toLowerCase();
  const matching = queues.filter((queue) =>
    query === "" ? true : queue.name.toLowerCase().includes(query),
  );

  return (
    <ContentLayout header={<Header variant="h1">Queues</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading queues"
        items={matching}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
        trackBy={(queue) => queue.url}
        header={
          <Header
            counter={loading ? undefined : `(${queues.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                <Button
                  disabled={selected.length === 0}
                  onClick={() => void runOnSelected("purge")}
                >
                  Purge
                </Button>
                <Button
                  disabled={selected.length === 0}
                  onClick={() => void runOnSelected("delete")}
                >
                  Delete
                </Button>
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  Create queue
                </Button>
              </SpaceBetween>
            }
          >
            Queues
          </Header>
        }
        columnDefinitions={[
          {
            id: "name",
            header: "Name",
            isRowHeader: true,
            cell: (queue) => (
              <Link
                href={`/sqs/queues/${queue.name}`}
                onFollow={(event) => {
                  event.preventDefault();
                  navigate(`/sqs/queues/${queue.name}`);
                }}
              >
                {queue.name}
              </Link>
            ),
          },
          { id: "type", header: "Type", cell: (queue) => queue.type },
          { id: "created", header: "Created", cell: (queue) => formatSqsTimestamp(queue.created) },
          {
            id: "available",
            header: "Messages available",
            cell: (queue) => queue.available ?? "—",
          },
          {
            id: "inFlight",
            header: "Messages in flight",
            cell: (queue) => queue.inFlight ?? "—",
          },
        ]}
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder="Search queues by prefix"
            filteringAriaLabel="Search queues"
            countText={query ? `${matching.length} matches` : ""}
            onChange={(event) => setFilterText(event.detail.filteringText)}
          />
        }
        empty={
          failed ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">Couldn't load queues</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No queues</Box>
                <Box variant="p" color="text-body-secondary">
                  Create a queue to start sending and receiving messages.
                </Box>
                <Button onClick={() => setCreateOpen(true)}>Create queue</Button>
              </SpaceBetween>
            </Box>
          )
        }
      />

      <CreateQueueModal
        visible={createOpen}
        onDismiss={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          await load();
        }}
      />
    </ContentLayout>
  );
}
