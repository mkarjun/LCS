import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  DescribeSubscriptionFiltersCommand,
  ListTagsLogGroupCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import type { LogGroup, LogStream } from "@aws-sdk/client-cloudwatch-logs";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import {
  dash,
  decodeLogName,
  encodeLogName,
  formatBytes,
  formatDateTime,
  formatRetention,
} from "./cloudwatchFormat";

export default function LogGroupDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const client = useAwsClient(CloudWatchLogsClient);
  const { notify } = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();

  // The wildcard route captures the encoded name, slashes included.
  const logGroupName = decodeLogName(params["*"] ?? "");

  const [group, setGroup] = useState<LogGroup | null>(null);
  const [streams, setStreams] = useState<LogStream[]>([]);
  const [tags, setTags] = useState<{ key: string; value: string }[]>([]);
  const [subscriptions, setSubscriptions] = useState<{ name: string; destination: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterText, setFilterText] = useState("");

  const activeTab = searchParams.get("tab") ?? "streams";

  useBreadcrumbs([
    { text: "CloudWatch", href: "/cloudwatch" },
    { text: "Log groups", href: "/cloudwatch" },
    { text: logGroupName, href: `/cloudwatch/log-groups/${encodeLogName(logGroupName)}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(
        new DescribeLogGroupsCommand({ logGroupNamePrefix: logGroupName, limit: 50 }),
      );
      setGroup(
        (response.logGroups ?? []).find((item) => item.logGroupName === logGroupName) ?? null,
      );
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load log group — ${title}`, content: detail });
    }

    // Sub-resources are best effort so one failure cannot blank the page.
    const [streamResult, tagResult, subscriptionResult] = await Promise.allSettled([
      client.send(
        new DescribeLogStreamsCommand({
          logGroupName,
          orderBy: "LastEventTime",
          descending: true,
          limit: 50,
        }),
      ),
      client.send(new ListTagsLogGroupCommand({ logGroupName })),
      client.send(new DescribeSubscriptionFiltersCommand({ logGroupName })),
    ]);

    setStreams(streamResult.status === "fulfilled" ? (streamResult.value.logStreams ?? []) : []);
    setTags(
      tagResult.status === "fulfilled"
        ? Object.entries(tagResult.value.tags ?? {}).map(([key, value]) => ({ key, value }))
        : [],
    );
    setSubscriptions(
      subscriptionResult.status === "fulfilled"
        ? (subscriptionResult.value.subscriptionFilters ?? []).map((filter) => ({
            name: filter.filterName ?? "",
            destination: filter.destinationArn ?? "",
          }))
        : [],
    );
    setLoading(false);
  }, [client, logGroupName, notify]);

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

  const field = (label: string, content: React.ReactNode) => (
    <SpaceBetween size="xxs">
      <Box variant="awsui-key-label">{label}</Box>
      <Box>{content}</Box>
    </SpaceBetween>
  );

  const matchingStreams = streams.filter((stream) =>
    filterText.trim() === ""
      ? true
      : (stream.logStreamName ?? "").toLowerCase().includes(filterText.trim().toLowerCase()),
  );

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />}
        >
          {logGroupName}
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Log group details</Header>}>
          <ColumnLayout columns={3} variant="text-grid">
            {field("Log class", group?.logGroupClass ?? "Standard")}
            {field("ARN", dash(group?.arn))}
            {field("Creation time", formatDateTime(group?.creationTime))}
            {field("Retention", formatRetention(group?.retentionInDays))}
            {field("Stored bytes", formatBytes(group?.storedBytes))}
            {field("Metric filters", dash(group?.metricFilterCount))}
            {field("Subscription filters", String(subscriptions.length))}
            {field("KMS key ID", dash(group?.kmsKeyId))}
            {field("Data protection", dash(group?.dataProtectionStatus))}
          </ColumnLayout>
        </Container>

        <Tabs
          activeTabId={activeTab}
          onChange={(event) => setSearchParams({ tab: event.detail.activeTabId })}
          tabs={[
            {
              id: "streams",
              label: "Log streams",
              content: (
                <Table
                  variant="container"
                  items={matchingStreams}
                  trackBy={(stream) => stream.logStreamName ?? ""}
                  header={
                    <Header
                      variant="h2"
                      counter={`(${streams.length})`}
                      description="By default, we only load the most recent log streams."
                    >
                      Log streams
                    </Header>
                  }
                  columnDefinitions={[
                    {
                      id: "name",
                      header: "Log stream",
                      isRowHeader: true,
                      cell: (stream) => (
                        <Link
                          href={`/cloudwatch/log-groups/streams/${encodeLogName(logGroupName)}/${encodeLogName(stream.logStreamName ?? "")}`}
                          onFollow={(event) => {
                            event.preventDefault();
                            navigate(
                              `/cloudwatch/log-groups/streams/${encodeLogName(logGroupName)}/${encodeLogName(stream.logStreamName ?? "")}`,
                            );
                          }}
                        >
                          {stream.logStreamName}
                        </Link>
                      ),
                    },
                    {
                      id: "lastEvent",
                      header: "Last event time",
                      cell: (stream) => formatDateTime(stream.lastEventTimestamp),
                    },
                  ]}
                  filter={
                    <TextFilter
                      filteringText={filterText}
                      filteringPlaceholder="Filter log streams or try prefix search"
                      filteringAriaLabel="Filter log streams"
                      countText={filterText ? `${matchingStreams.length} matches` : ""}
                      onChange={(event) => setFilterText(event.detail.filteringText)}
                    />
                  }
                  empty={
                    <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                      No log streams in this log group.
                    </Box>
                  }
                />
              ),
            },
            {
              id: "tags",
              label: "Tags",
              content: (
                <Table
                  variant="container"
                  header={
                    <Header variant="h2" counter={`(${tags.length})`}>
                      Tags
                    </Header>
                  }
                  items={tags}
                  trackBy={(tag) => tag.key}
                  columnDefinitions={[
                    { id: "key", header: "Key", cell: (tag) => tag.key, isRowHeader: true },
                    { id: "value", header: "Value", cell: (tag) => tag.value },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                      No tags associated with this log group.
                    </Box>
                  }
                />
              ),
            },
            {
              id: "subscription-filters",
              label: "Subscription filters",
              content: (
                <Table
                  variant="container"
                  header={
                    <Header variant="h2" counter={`(${subscriptions.length})`}>
                      Subscription filters
                    </Header>
                  }
                  items={subscriptions}
                  trackBy={(filter) => filter.name}
                  columnDefinitions={[
                    { id: "name", header: "Name", cell: (f) => f.name, isRowHeader: true },
                    { id: "destination", header: "Destination", cell: (f) => f.destination },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                      No subscription filters on this log group.
                    </Box>
                  }
                />
              ),
            },
          ]}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}
