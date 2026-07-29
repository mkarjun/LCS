import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LambdaClient, ListFunctionsCommand, ListLayersCommand } from "@aws-sdk/client-lambda";
import type { FunctionConfiguration, LayersListItem } from "@aws-sdk/client-lambda";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { CreateFunctionModal } from "./CreateFunctionModal";
import { formatLambdaDate } from "./lambdaFormat";

const PAGE_SIZE = 20;

/** One component serves both Functions and Layers — same table shape, different source. */
export default function FunctionsPage({ layersView = false }: { layersView?: boolean }) {
  const navigate = useNavigate();
  const client = useAwsClient(LambdaClient);
  const { notify } = useNotifications();

  const [functions, setFunctions] = useState<FunctionConfiguration[]>([]);
  const [layers, setLayers] = useState<LayersListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  useBreadcrumbs(
    layersView
      ? [
          { text: "Lambda", href: "/lambda" },
          { text: "Layers", href: "/lambda/layers" },
        ]
      : [
          { text: "Lambda", href: "/lambda" },
          { text: "Functions", href: "/lambda" },
        ],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (layersView) {
        setLayers((await client.send(new ListLayersCommand({}))).Layers ?? []);
      } else {
        setFunctions((await client.send(new ListFunctionsCommand({}))).Functions ?? []);
      }
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, layersView, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const query = filterText.trim().toLowerCase();
  const rows: (FunctionConfiguration | LayersListItem)[] = layersView ? layers : functions;
  const matching = rows.filter((row) =>
    query === "" ? true : JSON.stringify(row).toLowerCase().includes(query),
  );
  const pageItems = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const columns = layersView
    ? [
        {
          id: "name",
          header: "Layer name",
          isRowHeader: true,
          cell: (row: LayersListItem) => row.LayerName ?? "-",
        },
        {
          id: "runtimes",
          header: "Compatible runtimes",
          cell: (row: LayersListItem) =>
            (row.LatestMatchingVersion?.CompatibleRuntimes ?? []).join(", ") || "—",
        },
        {
          id: "version",
          header: "Version",
          cell: (row: LayersListItem) => row.LatestMatchingVersion?.Version ?? "—",
        },
      ]
    : [
        {
          id: "name",
          header: "Function name",
          isRowHeader: true,
          cell: (row: FunctionConfiguration) => (
            <Link
              href={`/lambda/functions/${row.FunctionName}`}
              onFollow={(event) => {
                event.preventDefault();
                navigate(`/lambda/functions/${row.FunctionName}`);
              }}
            >
              {row.FunctionName}
            </Link>
          ),
        },
        {
          id: "description",
          header: "Description",
          cell: (row: FunctionConfiguration) => row.Description || "—",
        },
        {
          id: "runtime",
          header: "Runtime",
          cell: (row: FunctionConfiguration) => row.Runtime ?? "—",
        },
        {
          id: "package",
          header: "Package type",
          cell: (row: FunctionConfiguration) => row.PackageType ?? "Zip",
        },
        {
          id: "memory",
          header: "Memory (MB)",
          cell: (row: FunctionConfiguration) => row.MemorySize ?? "—",
        },
        {
          id: "modified",
          header: "Last modified",
          cell: (row: FunctionConfiguration) => formatLambdaDate(row.LastModified),
        },
      ];

  const title = layersView ? "Layers" : "Functions";

  return (
    <ContentLayout header={<Header variant="h1">{title}</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText={`Loading ${title.toLowerCase()}`}
        items={pageItems as never[]}
        trackBy={(row: never) =>
          layersView
            ? ((row as LayersListItem).LayerName ?? "")
            : ((row as FunctionConfiguration).FunctionName ?? "")
        }
        columnDefinitions={columns as never}
        header={
          <Header
            counter={loading ? undefined : `(${rows.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                {!layersView && (
                  <Button variant="primary" onClick={() => setCreateOpen(true)}>
                    Create function
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            {title}
          </Header>
        }
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder={layersView ? "Find layers" : "Find functions"}
            filteringAriaLabel="Find"
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
                <Box variant="strong">Couldn't load {title.toLowerCase()}</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No {title.toLowerCase()}</Box>
                <Box variant="p" color="text-body-secondary">
                  {layersView
                    ? "You have not published any layers in this Region."
                    : "Create a function to run code without provisioning servers."}
                </Box>
                {!layersView && (
                  <Button onClick={() => setCreateOpen(true)}>Create function</Button>
                )}
              </SpaceBetween>
            </Box>
          )
        }
      />

      <CreateFunctionModal
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
