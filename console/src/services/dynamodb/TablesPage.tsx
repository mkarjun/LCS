import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import type { TableDescription } from "@aws-sdk/client-dynamodb";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { CreateTableModal } from "./CreateTableModal";
import { formatBytes, keySchemaSummary } from "./dynamoFormat";

export default function TablesPage({ exploreMode = false }: { exploreMode?: boolean } = {}) {
  const navigate = useNavigate();
  const client = useAwsClient(DynamoDBClient);
  const { notify } = useNotifications();

  const [tables, setTables] = useState<TableDescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  useBreadcrumbs([
    { text: "DynamoDB", href: "/dynamodb" },
    { text: exploreMode ? "Explore items" : "Tables", href: exploreMode ? "/dynamodb/explore" : "/dynamodb/tables" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const names = (await client.send(new ListTablesCommand({}))).TableNames ?? [];
      // ListTables returns names only; the console shows partition key, status, size and
      // item count, so each table is described. Best-effort per table.
      const described = await Promise.all(
        names.map(async (name) => {
          try {
            return (await client.send(new DescribeTableCommand({ TableName: name }))).Table ?? {
              TableName: name,
            };
          } catch {
            return { TableName: name } as TableDescription;
          }
        }),
      );
      setTables(described);
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load tables — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const query = filterText.trim().toLowerCase();
  const matching = tables.filter((table) =>
    query === "" ? true : (table.TableName ?? "").toLowerCase().includes(query),
  );

  return (
    <ContentLayout header={<Header variant="h1">{exploreMode ? "Explore items" : "Tables"}</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading tables"
        items={matching}
        trackBy={(table) => table.TableName ?? ""}
        header={
          <Header
            counter={loading ? undefined : `(${tables.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  Create table
                </Button>
              </SpaceBetween>
            }
          >
            Tables
          </Header>
        }
        columnDefinitions={[
          {
            id: "name",
            header: "Name",
            isRowHeader: true,
            cell: (table) => (
              <Link
                href={`/dynamodb/tables/${table.TableName}`}
                onFollow={(event) => {
                  event.preventDefault();
                  navigate(`/dynamodb/tables/${table.TableName}${exploreMode ? "?tab=items" : ""}`);
                }}
              >
                {table.TableName}
              </Link>
            ),
          },
          {
            id: "status",
            header: "Status",
            cell: (table) =>
              table.TableStatus === "ACTIVE" ? (
                <StatusIndicator type="success">Active</StatusIndicator>
              ) : (
                <StatusIndicator type="pending">{table.TableStatus ?? "—"}</StatusIndicator>
              ),
          },
          {
            id: "partitionKey",
            header: "Partition key",
            cell: (table) => keySchemaSummary(table, "HASH"),
          },
          {
            id: "sortKey",
            header: "Sort key",
            cell: (table) => keySchemaSummary(table, "RANGE"),
          },
          {
            id: "billing",
            header: "Capacity mode",
            cell: (table) =>
              table.BillingModeSummary?.BillingMode === "PAY_PER_REQUEST"
                ? "On-demand"
                : "Provisioned",
          },
          { id: "items", header: "Item count", cell: (table) => table.ItemCount ?? 0 },
          { id: "size", header: "Size", cell: (table) => formatBytes(table.TableSizeBytes) },
        ]}
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder="Find tables"
            filteringAriaLabel="Find tables"
            countText={query ? `${matching.length} matches` : ""}
            onChange={(event) => setFilterText(event.detail.filteringText)}
          />
        }
        empty={
          failed ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">Couldn't load tables</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No tables</Box>
                <Box variant="p" color="text-body-secondary">
                  Create a table to store items in DynamoDB.
                </Box>
                <Button onClick={() => setCreateOpen(true)}>Create table</Button>
              </SpaceBetween>
            </Box>
          )
        }
      />

      <CreateTableModal
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
