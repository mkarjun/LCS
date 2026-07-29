import { useCallback, useEffect, useState } from "react";
import { CloudWatchClient, ListMetricsCommand } from "@aws-sdk/client-cloudwatch";
import type { Metric } from "@aws-sdk/client-cloudwatch";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";

const PAGE_SIZE = 25;

export default function MetricsPage() {
  const client = useAwsClient(CloudWatchClient);
  const { notify } = useNotifications();

  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useBreadcrumbs([
    { text: "CloudWatch", href: "/cloudwatch" },
    { text: "All metrics", href: "/cloudwatch/metrics" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMetrics((await client.send(new ListMetricsCommand({}))).Metrics ?? []);
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load metrics — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const query = filterText.trim().toLowerCase();
  const matching = metrics.filter((metric) =>
    query === "" ? true : JSON.stringify(metric).toLowerCase().includes(query),
  );
  const pageItems = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <ContentLayout header={<Header variant="h1">Metrics</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading metrics"
        items={pageItems}
        trackBy={(metric) =>
          `${metric.Namespace}/${metric.MetricName}/${(metric.Dimensions ?? [])
            .map((d) => `${d.Name}=${d.Value}`)
            .join(",")}`
        }
        header={
          <Header
            counter={loading ? undefined : `(${metrics.length})`}
            description="Metrics published by emulated services and by your own PutMetricData calls."
            actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />}
          >
            All metrics
          </Header>
        }
        columnDefinitions={[
          {
            id: "namespace",
            header: "Namespace",
            cell: (metric) => metric.Namespace ?? "-",
            isRowHeader: true,
          },
          { id: "name", header: "Metric name", cell: (metric) => metric.MetricName ?? "-" },
          {
            id: "dimensions",
            header: "Dimensions",
            cell: (metric) =>
              (metric.Dimensions ?? []).map((d) => `${d.Name}=${d.Value}`).join(", ") || "—",
          },
        ]}
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder="Search for any metric, dimension or resource id"
            filteringAriaLabel="Search metrics"
            countText={query ? `${matching.length} matches` : ""}
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
                <Box variant="strong">Couldn't load metrics</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No metrics</Box>
                <Box variant="p" color="text-body-secondary">
                  Metrics appear once a service publishes them.
                </Box>
              </SpaceBetween>
            </Box>
          )
        }
      />
    </ContentLayout>
  );
}
