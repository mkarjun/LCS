import { useCallback, useEffect, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import type { TableProps } from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import type { Crumb } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";

const PAGE_SIZE = 20;

interface IamListPageProps<T> {
  title: string;
  description: string;
  filterPlaceholder: string;
  emptyTitle: string;
  emptyText: string;
  crumbs: Crumb[];
  columns: TableProps.ColumnDefinition<T>[];
  trackBy: (row: T) => string;
  load: () => Promise<T[]>;
  /** Primary action, e.g. "Create user". Omitted when the operation is unsupported. */
  primaryAction?: { label: string; onClick: () => void };
  /** Extra header actions rendered before the primary action. */
  secondaryActions?: React.ReactNode;
  /** Rendered after the table, e.g. create modals. */
  children?: React.ReactNode;
  /** Bumping this reloads the table — used after a create or delete. */
  reloadToken?: number;
}

/**
 * Shared IAM list page.
 *
 * Users, roles, groups, and policies are all the same shape in the AWS console: a
 * filtered, paginated table with a create action. Defining that once keeps their
 * behavior identical rather than four drifting copies.
 */
export function IamListPage<T>({
  title,
  description,
  filterPlaceholder,
  emptyTitle,
  emptyText,
  crumbs,
  columns,
  trackBy,
  load,
  primaryAction,
  secondaryActions,
  children,
  reloadToken = 0,
}: IamListPageProps<T>) {
  const { notify } = useNotifications();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useBreadcrumbs(crumbs);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await load());
      setFailed(false);
    } catch (cause) {
      const { title: errorTitle, detail } = describeAwsError(cause);
      setFailed(true);
      notify({
        type: "error",
        header: `Couldn't load ${title.toLowerCase()} — ${errorTitle}`,
        content: detail,
      });
    } finally {
      setLoading(false);
    }
    // `load` is recreated per render by callers, so the token drives reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, title, reloadToken]);

  useEffect(() => {
    void run();
  }, [run]);

  const query = filterText.trim().toLowerCase();
  const matching = rows.filter((row) =>
    query === "" ? true : JSON.stringify(row).toLowerCase().includes(query),
  );
  const pageItems = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <ContentLayout header={<Header variant="h1">{title}</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText={`Loading ${title.toLowerCase()}`}
        items={pageItems}
        trackBy={trackBy}
        columnDefinitions={columns}
        header={
          <Header
            counter={loading ? undefined : `(${rows.length})`}
            description={description}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void run()} />
                {secondaryActions}
                {primaryAction && (
                  <Button variant="primary" onClick={primaryAction.onClick}>
                    {primaryAction.label}
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
            filteringPlaceholder={filterPlaceholder}
            filteringAriaLabel={filterPlaceholder}
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
                <Button onClick={() => void run()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">{emptyTitle}</Box>
                <Box variant="p" color="text-body-secondary">
                  {emptyText}
                </Box>
                {primaryAction && (
                  <Button onClick={primaryAction.onClick}>{primaryAction.label}</Button>
                )}
              </SpaceBetween>
            </Box>
          )
        }
      />
      {children}
    </ContentLayout>
  );
}
