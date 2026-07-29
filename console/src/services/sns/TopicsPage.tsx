import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DeleteTopicCommand,
  GetTopicAttributesCommand,
  ListTopicsCommand,
  SNSClient,
} from "@aws-sdk/client-sns";
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
import { CreateTopicModal } from "./CreateTopicModal";
import { topicNameFromArn, topicType } from "./snsFormat";

interface TopicRow {
  arn: string;
  name: string;
  type: string;
  displayName?: string;
  confirmed?: string;
}

export default function TopicsPage() {
  const navigate = useNavigate();
  const client = useAwsClient(SNSClient);
  const { notify } = useNotifications();

  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [selected, setSelected] = useState<TopicRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  useBreadcrumbs([
    { text: "Amazon SNS", href: "/sns" },
    { text: "Topics", href: "/sns" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const arns = (await client.send(new ListTopicsCommand({}))).Topics ?? [];
      // ListTopics returns ARNs only; display name and subscription counts need attributes.
      const rows = await Promise.all(
        arns.map(async (topic): Promise<TopicRow> => {
          const arn = topic.TopicArn ?? "";
          const base: TopicRow = { arn, name: topicNameFromArn(arn), type: topicType(arn) };
          try {
            const attributes = (
              await client.send(new GetTopicAttributesCommand({ TopicArn: arn }))
            ).Attributes;
            return {
              ...base,
              displayName: attributes?.DisplayName,
              confirmed: attributes?.SubscriptionsConfirmed,
            };
          } catch {
            return base;
          }
        }),
      );
      setTopics(rows);
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load topics — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const deleteSelected = async () => {
    try {
      await Promise.all(
        selected.map((topic) => client.send(new DeleteTopicCommand({ TopicArn: topic.arn }))),
      );
      notify({ type: "success", content: `Deleted ${selected.length} topic(s).` });
      setSelected([]);
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't delete topic — ${title}`, content: detail });
    }
  };

  const query = filterText.trim().toLowerCase();
  const matching = topics.filter((topic) =>
    query === "" ? true : topic.name.toLowerCase().includes(query),
  );

  return (
    <ContentLayout header={<Header variant="h1">Topics</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading topics"
        items={matching}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
        trackBy={(topic) => topic.arn}
        header={
          <Header
            counter={loading ? undefined : `(${topics.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                <Button disabled={selected.length === 0} onClick={() => void deleteSelected()}>
                  Delete
                </Button>
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  Create topic
                </Button>
              </SpaceBetween>
            }
          >
            Topics
          </Header>
        }
        columnDefinitions={[
          {
            id: "name",
            header: "Name",
            isRowHeader: true,
            cell: (topic) => (
              <Link
                href={`/sns/topics/${topic.name}`}
                onFollow={(event) => {
                  event.preventDefault();
                  navigate(`/sns/topics/${topic.name}`);
                }}
              >
                {topic.name}
              </Link>
            ),
          },
          { id: "type", header: "Type", cell: (topic) => topic.type },
          { id: "arn", header: "ARN", cell: (topic) => topic.arn },
          {
            id: "displayName",
            header: "Display name",
            cell: (topic) => topic.displayName || "—",
          },
          {
            id: "subscriptions",
            header: "Subscriptions confirmed",
            cell: (topic) => topic.confirmed ?? "—",
          },
        ]}
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder="Search topics"
            filteringAriaLabel="Search topics"
            countText={query ? `${matching.length} matches` : ""}
            onChange={(event) => setFilterText(event.detail.filteringText)}
          />
        }
        empty={
          failed ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">Couldn't load topics</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No topics</Box>
                <Box variant="p" color="text-body-secondary">
                  Create a topic to publish messages to subscribers.
                </Box>
                <Button onClick={() => setCreateOpen(true)}>Create topic</Button>
              </SpaceBetween>
            </Box>
          )
        }
      />

      <CreateTopicModal
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
