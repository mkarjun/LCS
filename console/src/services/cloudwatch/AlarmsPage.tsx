import { useCallback, useEffect, useState } from "react";
import { CloudWatchClient, DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import type { MetricAlarm } from "@aws-sdk/client-cloudwatch";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { dash, formatDateTime } from "./cloudwatchFormat";

/** AWS colours alarm state: red in ALARM, green OK, grey when data is insufficient. */
function alarmState(state: string | undefined) {
  switch (state) {
    case "ALARM":
      return <StatusIndicator type="error">In alarm</StatusIndicator>;
    case "OK":
      return <StatusIndicator type="success">OK</StatusIndicator>;
    default:
      return <StatusIndicator type="pending">Insufficient data</StatusIndicator>;
  }
}

/** Renders the alarm rule the way the console's Conditions column does. */
function condition(alarm: MetricAlarm): string {
  const operators: Record<string, string> = {
    GreaterThanThreshold: ">",
    GreaterThanOrEqualToThreshold: ">=",
    LessThanThreshold: "<",
    LessThanOrEqualToThreshold: "<=",
  };
  const operator = operators[alarm.ComparisonOperator ?? ""] ?? alarm.ComparisonOperator ?? "";
  if (!alarm.MetricName) {
    return "—";
  }
  return `${alarm.Statistic ?? ""} ${alarm.MetricName} ${operator} ${alarm.Threshold ?? ""} for ${alarm.EvaluationPeriods ?? 1} datapoints`.trim();
}

export default function AlarmsPage() {
  const client = useAwsClient(CloudWatchClient);
  const { notify } = useNotifications();

  const [alarms, setAlarms] = useState<MetricAlarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");

  useBreadcrumbs([
    { text: "CloudWatch", href: "/cloudwatch" },
    { text: "Alarms", href: "/cloudwatch/alarms" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAlarms((await client.send(new DescribeAlarmsCommand({}))).MetricAlarms ?? []);
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load alarms — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const query = filterText.trim().toLowerCase();
  const matching = alarms.filter((alarm) =>
    query === "" ? true : (alarm.AlarmName ?? "").toLowerCase().includes(query),
  );

  return (
    <ContentLayout header={<Header variant="h1">Alarms</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading alarms"
        items={matching}
        trackBy={(alarm) => alarm.AlarmName ?? ""}
        header={
          <Header
            counter={loading ? undefined : `(${alarms.length})`}
            actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />}
          >
            Alarms
          </Header>
        }
        columnDefinitions={[
          { id: "name", header: "Name", cell: (a) => a.AlarmName ?? "-", isRowHeader: true },
          { id: "state", header: "State", cell: (a) => alarmState(a.StateValue) },
          {
            id: "lastUpdate",
            header: "Last state update",
            cell: (a) => formatDateTime(a.StateUpdatedTimestamp?.getTime()),
          },
          { id: "conditions", header: "Conditions", cell: (a) => condition(a) },
          { id: "namespace", header: "Namespace", cell: (a) => dash(a.Namespace) },
        ]}
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder="Filter alarms"
            filteringAriaLabel="Filter alarms"
            countText={query ? `${matching.length} matches` : ""}
            onChange={(event) => setFilterText(event.detail.filteringText)}
          />
        }
        empty={
          failed ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">Couldn't load alarms</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No alarms</Box>
                <Box variant="p" color="text-body-secondary">
                  No alarms to display.
                </Box>
              </SpaceBetween>
            </Box>
          )
        }
      />
    </ContentLayout>
  );
}
