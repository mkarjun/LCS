import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import type { FilteredLogEvent, OutputLogEvent } from "@aws-sdk/client-cloudwatch-logs";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { decodeLogName, encodeLogName, formatEventTimestamp } from "./cloudwatchFormat";

interface EventRow {
  id: string;
  timestamp?: number;
  message?: string;
}

/** AWS's relative time ranges on the log events view, in minutes. */
const RANGES = [
  { id: "1m", text: "1m", minutes: 1 },
  { id: "30m", text: "30m", minutes: 30 },
  { id: "1h", text: "1h", minutes: 60 },
  { id: "12h", text: "12h", minutes: 720 },
  { id: "all", text: "All", minutes: 0 },
];

export default function LogEventsPage() {
  const params = useParams();
  const client = useAwsClient(CloudWatchLogsClient);
  const { notify } = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();

  // Wildcard captures "<encodedGroup>/<encodedStream>".
  const [encodedGroup = "", encodedStream = ""] = (params["*"] ?? "").split("/");
  const logGroupName = decodeLogName(encodedGroup);
  const logStreamName = decodeLogName(encodedStream);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterDraft, setFilterDraft] = useState(searchParams.get("filter") ?? "");
  const [range, setRange] = useState("all");

  // AWS applies the filter on Enter, not on every keystroke.
  const appliedFilter = searchParams.get("filter") ?? "";

  useBreadcrumbs([
    { text: "CloudWatch", href: "/cloudwatch" },
    { text: "Log groups", href: "/cloudwatch" },
    { text: logGroupName, href: `/cloudwatch/log-groups/${encodeLogName(logGroupName)}` },
    {
      text: logStreamName,
      href: `/cloudwatch/log-groups/streams/${encodeLogName(logGroupName)}/${encodeLogName(logStreamName)}`,
    },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    const minutes = RANGES.find((entry) => entry.id === range)?.minutes ?? 0;
    const startTime = minutes > 0 ? Date.now() - minutes * 60_000 : undefined;

    try {
      if (appliedFilter !== "") {
        // FilterLogEvents is the only call that supports a pattern.
        const response = await client.send(
          new FilterLogEventsCommand({
            logGroupName,
            logStreamNames: [logStreamName],
            filterPattern: appliedFilter,
            ...(startTime ? { startTime } : {}),
            limit: 500,
          }),
        );
        setEvents(
          (response.events ?? []).map((event: FilteredLogEvent, index) => ({
            id: event.eventId ?? `${event.timestamp}-${index}`,
            timestamp: event.timestamp,
            message: event.message,
          })),
        );
      } else {
        const response = await client.send(
          new GetLogEventsCommand({
            logGroupName,
            logStreamName,
            ...(startTime ? { startTime } : {}),
            limit: 500,
            startFromHead: true,
          }),
        );
        setEvents(
          (response.events ?? []).map((event: OutputLogEvent, index) => ({
            id: `${event.timestamp}-${index}`,
            timestamp: event.timestamp,
            message: event.message,
          })),
        );
      }
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load log events — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, logGroupName, logStreamName, appliedFilter, range, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilter = () => {
    const next = new URLSearchParams(searchParams);
    if (filterDraft.trim() === "") {
      next.delete("filter");
    } else {
      next.set("filter", filterDraft.trim());
    }
    setSearchParams(next);
  };

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Use the filter bar to search for and match terms, phrases, or values in your log events."
          actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />}
        >
          Log events
        </Header>
      }
    >
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading log events"
        items={events}
        trackBy={(event) => event.id}
        wrapLines
        columnDefinitions={[
          {
            id: "timestamp",
            header: "Timestamp",
            width: 260,
            cell: (event) => formatEventTimestamp(event.timestamp),
            isRowHeader: true,
          },
          {
            id: "message",
            header: "Message",
            cell: (event) => (
              <Box variant="code" fontSize="body-s">
                {event.message}
              </Box>
            ),
          },
        ]}
        filter={
          <SpaceBetween size="s" direction="horizontal" alignItems="center">
            <Input
              value={filterDraft}
              type="search"
              placeholder="Filter events - press enter to search"
              ariaLabel="Filter events"
              onChange={(event) => setFilterDraft(event.detail.value)}
              onKeyDown={(event) => {
                if (event.detail.key === "Enter") {
                  applyFilter();
                }
              }}
            />
            <Button
              disabled={appliedFilter === "" && filterDraft === ""}
              onClick={() => {
                setFilterDraft("");
                const next = new URLSearchParams(searchParams);
                next.delete("filter");
                setSearchParams(next);
              }}
            >
              Clear
            </Button>
            <SegmentedControl
              selectedId={range}
              onChange={(event) => setRange(event.detail.selectedId)}
              label="Time range"
              options={RANGES.map(({ id, text }) => ({ id, text }))}
            />
          </SpaceBetween>
        }
        empty={
          failed ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">Couldn't load log events</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }} color="text-body-secondary">
              {appliedFilter
                ? "No events matched the filter pattern in this time range."
                : "No events found in this log stream for the selected time range."}
            </Box>
          )
        }
      />
    </ContentLayout>
  );
}
