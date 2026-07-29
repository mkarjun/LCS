import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  DeleteItemCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ListTagsOfResourceCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import type { AttributeValue, TableDescription } from "@aws-sdk/client-dynamodb";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { PutItemModal } from "./PutItemModal";
import { formatBytes, itemColumns, keySchemaSummary, renderAttribute } from "./dynamoFormat";

type Item = Record<string, AttributeValue>;

export default function TableDetailPage() {
  const { tableName = "" } = useParams();
  const client = useAwsClient(DynamoDBClient);
  const { notify } = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();

  const [table, setTable] = useState<TableDescription | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [tags, setTags] = useState<{ key: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [selected, setSelected] = useState<Item[]>([]);
  const [putOpen, setPutOpen] = useState(false);

  const activeTab = searchParams.get("tab") ?? "overview";

  useBreadcrumbs([
    { text: "DynamoDB", href: "/dynamodb" },
    { text: "Tables", href: "/dynamodb" },
    { text: tableName, href: `/dynamodb/tables/${tableName}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(new DescribeTableCommand({ TableName: tableName }));
      setTable(response.Table ?? null);

      if (response.Table?.TableArn) {
        try {
          const tagResponse = await client.send(
            new ListTagsOfResourceCommand({ ResourceArn: response.Table.TableArn }),
          );
          setTags(
            (tagResponse.Tags ?? []).map((tag) => ({ key: tag.Key ?? "", value: tag.Value ?? "" })),
          );
        } catch {
          setTags([]);
        }
      }
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load table — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, tableName, notify]);

  const loadItems = useCallback(async () => {
    setItemsLoading(true);
    try {
      const response = await client.send(new ScanCommand({ TableName: tableName, Limit: 200 }));
      setItems((response.Items ?? []) as Item[]);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't scan table — ${title}`, content: detail });
    } finally {
      setItemsLoading(false);
    }
  }, [client, tableName, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (activeTab === "items") {
      void loadItems();
    }
  }, [activeTab, loadItems]);

  /** Deletion needs the full key, which varies per table, so it is read from the schema. */
  const deleteSelected = async () => {
    const keyNames = (table?.KeySchema ?? [])
      .map((key) => key.AttributeName)
      .filter((name): name is string => !!name);
    try {
      await Promise.all(
        selected.map((item) => {
          const key: Item = {};
          for (const name of keyNames) {
            if (item[name] !== undefined) {
              key[name] = item[name];
            }
          }
          return client.send(new DeleteItemCommand({ TableName: tableName, Key: key }));
        }),
      );
      notify({ type: "success", content: `Deleted ${selected.length} item(s).` });
      setSelected([]);
      await loadItems();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't delete items — ${title}`, content: detail });
    }
  };

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

  const query = filterText.trim().toLowerCase();
  const matchingItems = items.filter((item) =>
    query === "" ? true : JSON.stringify(item).toLowerCase().includes(query),
  );
  const columns = itemColumns(items, table);

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />}
        >
          {tableName}
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">General information</Header>}>
          <ColumnLayout columns={4} variant="text-grid">
            {field(
              "Status",
              table?.TableStatus === "ACTIVE" ? (
                <StatusIndicator type="success">Active</StatusIndicator>
              ) : (
                <StatusIndicator type="pending">{table?.TableStatus ?? "—"}</StatusIndicator>
              ),
            )}
            {field("Partition key", table ? keySchemaSummary(table, "HASH") : "—")}
            {field("Sort key", table ? keySchemaSummary(table, "RANGE") : "—")}
            {field(
              "Capacity mode",
              table?.BillingModeSummary?.BillingMode === "PAY_PER_REQUEST"
                ? "On-demand"
                : "Provisioned",
            )}
            {field("Item count", String(table?.ItemCount ?? 0))}
            {field("Table size", formatBytes(table?.TableSizeBytes))}
            {field("Table ARN", table?.TableArn ?? "—")}
            {field(
              "Creation time",
              table?.CreationDateTime ? new Date(table.CreationDateTime).toLocaleString() : "—",
            )}
          </ColumnLayout>
        </Container>

        <Tabs
          activeTabId={activeTab}
          onChange={(event) => setSearchParams({ tab: event.detail.activeTabId })}
          tabs={[
            {
              id: "overview",
              label: "Overview",
              content: (
                <Table
                  variant="container"
                  header={<Header variant="h2">Key schema and attributes</Header>}
                  items={(table?.AttributeDefinitions ?? []).map((attribute) => {
                    const keyElement = (table?.KeySchema ?? []).find(
                      (key) => key.AttributeName === attribute.AttributeName,
                    );
                    return {
                      name: attribute.AttributeName ?? "",
                      type: attribute.AttributeType ?? "",
                      role:
                        keyElement?.KeyType === "HASH"
                          ? "Partition key"
                          : keyElement?.KeyType === "RANGE"
                            ? "Sort key"
                            : "Attribute",
                    };
                  })}
                  trackBy={(row) => row.name}
                  columnDefinitions={[
                    { id: "name", header: "Attribute name", cell: (r) => r.name, isRowHeader: true },
                    { id: "type", header: "Type", cell: (r) => r.type },
                    { id: "role", header: "Role", cell: (r) => r.role },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                      No attribute definitions.
                    </Box>
                  }
                />
              ),
            },
            {
              id: "items",
              label: "Explore items",
              content: (
                <Table
                  variant="container"
                  loading={itemsLoading}
                  loadingText="Scanning table"
                  items={matchingItems}
                  selectionType="multi"
                  selectedItems={selected}
                  onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
                  // Items have no id; the key attributes uniquely identify a row.
                  trackBy={(item) =>
                    (table?.KeySchema ?? [])
                      .map((key) => renderAttribute(item[key.AttributeName ?? ""]))
                      .join("|")
                  }
                  header={
                    <Header
                      variant="h2"
                      counter={itemsLoading ? undefined : `(${items.length})`}
                      description="Returned items are limited to the first 200 scanned."
                      actions={
                        <SpaceBetween direction="horizontal" size="xs">
                          <Button
                            iconName="refresh"
                            ariaLabel="Refresh items"
                            onClick={() => void loadItems()}
                          />
                          <Button
                            disabled={selected.length === 0}
                            onClick={() => void deleteSelected()}
                          >
                            Delete
                          </Button>
                          <Button variant="primary" onClick={() => setPutOpen(true)}>
                            Create item
                          </Button>
                        </SpaceBetween>
                      }
                    >
                      Items returned
                    </Header>
                  }
                  columnDefinitions={columns.map((name, index) => ({
                    id: name,
                    header: name,
                    isRowHeader: index === 0,
                    cell: (item: Item) => renderAttribute(item[name]),
                  }))}
                  filter={
                    <TextFilter
                      filteringText={filterText}
                      filteringPlaceholder="Find items"
                      filteringAriaLabel="Find items"
                      countText={query ? `${matchingItems.length} matches` : ""}
                      onChange={(event) => setFilterText(event.detail.filteringText)}
                    />
                  }
                  empty={
                    <Box textAlign="center" padding={{ vertical: "l" }}>
                      <SpaceBetween size="s">
                        <Box variant="strong">No items</Box>
                        <Box variant="p" color="text-body-secondary">
                          This table has no items yet.
                        </Box>
                        <Button onClick={() => setPutOpen(true)}>Create item</Button>
                      </SpaceBetween>
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
                      No tags associated with this table.
                    </Box>
                  }
                />
              ),
            },
          ]}
        />
      </SpaceBetween>

      <PutItemModal
        visible={putOpen}
        tableName={tableName}
        table={table}
        onDismiss={() => setPutOpen(false)}
        onCreated={async () => {
          setPutOpen(false);
          await loadItems();
        }}
      />
    </ContentLayout>
  );
}
