import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { CloudWatchClient, DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";

import { useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { CreateTableModal } from "./CreateTableModal";

/**
 * DynamoDB dashboard — the service's landing page in the AWS console.
 *
 * AWS shows Favorite tables, Alarms, and DAX clusters here alongside a "Create resources"
 * panel. Favorites are a console preference AWS stores per user; LCS has no such store,
 * so this shows recent tables instead of inventing a favouriting mechanism. DAX has no
 * backend here and is omitted.
 */
export default function DashboardPage() {
  const navigate = useNavigate();
  const client = useAwsClient(DynamoDBClient);
  const cloudwatch = useAwsClient(CloudWatchClient);

  const [tables, setTables] = useState<string[]>([]);
  const [alarms, setAlarms] = useState<{ name: string; state: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  useBreadcrumbs([
    { text: "DynamoDB", href: "/dynamodb" },
    { text: "Dashboard", href: "/dynamodb" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    const [tableResult, alarmResult] = await Promise.allSettled([
      client.send(new ListTablesCommand({})),
      cloudwatch.send(new DescribeAlarmsCommand({})),
    ]);
    setTables(tableResult.status === "fulfilled" ? (tableResult.value.TableNames ?? []) : []);
    setAlarms(
      alarmResult.status === "fulfilled"
        ? (alarmResult.value.MetricAlarms ?? [])
            // Only alarms watching DynamoDB belong on this dashboard.
            .filter((alarm) => alarm.Namespace === "AWS/DynamoDB")
            .map((alarm) => ({
              name: alarm.AlarmName ?? "",
              state: alarm.StateValue ?? "",
            }))
        : [],
    );
    setLoading(false);
  }, [client, cloudwatch]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ContentLayout header={<Header variant="h1">Dashboard</Header>}>
      <ColumnLayout columns={3}>
        <div style={{ gridColumn: "span 2" }}>
          <SpaceBetween size="l">
            <Table
              variant="container"
              loading={loading}
              loadingText="Loading tables"
              items={tables.map((name) => ({ name }))}
              trackBy={(row) => row.name}
              header={
                <Header
                  variant="h2"
                  counter={loading ? undefined : `(${tables.length})`}
                  actions={
                    <Button onClick={() => navigate("/dynamodb/tables")}>View all tables</Button>
                  }
                >
                  Tables
                </Header>
              }
              columnDefinitions={[
                {
                  id: "name",
                  header: "Table name",
                  isRowHeader: true,
                  cell: (row) => (
                    <Link
                      href={`/dynamodb/tables/${row.name}`}
                      onFollow={(event) => {
                        event.preventDefault();
                        navigate(`/dynamodb/tables/${row.name}`);
                      }}
                    >
                      {row.name}
                    </Link>
                  ),
                },
              ]}
              empty={
                <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                  No tables yet.
                </Box>
              }
            />

            <Table
              variant="container"
              items={alarms}
              trackBy={(alarm) => alarm.name}
              header={
                <Header variant="h2" counter={`(${alarms.length})`}>
                  Alarms
                </Header>
              }
              columnDefinitions={[
                { id: "name", header: "Alarm name", cell: (a) => a.name, isRowHeader: true },
                { id: "state", header: "Status", cell: (a) => a.state },
              ]}
              empty={
                <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                  No custom alarms
                </Box>
              }
            />
          </SpaceBetween>
        </div>

        <Container header={<Header variant="h2">Create resources</Header>}>
          <SpaceBetween size="m">
            <Box variant="p" color="text-body-secondary">
              Create an Amazon DynamoDB table for fast and predictable database performance at
              any scale.
            </Box>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              Create table
            </Button>
          </SpaceBetween>
        </Container>
      </ColumnLayout>

      <CreateTableModal
        visible={createOpen}
        onDismiss={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          await load();
          navigate("/dynamodb/tables");
        }}
      />
    </ContentLayout>
  );
}
