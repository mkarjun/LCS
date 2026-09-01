import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { EC2Client } from "@aws-sdk/client-ec2";
import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { AutoScalingClient } from "@aws-sdk/client-auto-scaling";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import type { TableProps } from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useEmulator } from "@platform/EmulatorContext";
import { useNotifications } from "@shell/NotificationContext";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import type { Ec2CreateModalProps } from "./create/createForm";

/**
 * The inventory-table page shared by the EC2 and VPC consoles.
 *
 * Both consoles are served by the same EC2 API, and for most resources both are the same
 * screen: describe, filter, sort, paginate, create, delete. The table lives here and each
 * console supplies only its resource definitions, so the two stay in step instead of
 * drifting into two implementations of one AWS pattern.
 */

const PAGE_SIZE_OPTIONS = [10, 25, 50];

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = any;

/**
 * The EC2 and VPC consoles span three APIs: EC2 itself, Elastic Load Balancing v2, and
 * Auto Scaling. Pages receive all three so each resource can use whichever it needs.
 */
export interface Ec2PageClients {
  ec2: EC2Client;
  elb: ElasticLoadBalancingV2Client;
  autoscaling: AutoScalingClient;
}

export function useEc2PageClients(): Ec2PageClients {
  const ec2 = useAwsClient(EC2Client);
  const elb = useAwsClient(ElasticLoadBalancingV2Client);
  const autoscaling = useAwsClient(AutoScalingClient);
  return useMemo(() => ({ ec2, elb, autoscaling }), [ec2, elb, autoscaling]);
}

/** Everything an action needs to run and then refresh the table behind it. */
export interface ActionContext {
  rows: Row[];
  clients: Ec2PageClients;
  onDismiss: () => void;
  onDone: () => Promise<void>;
}

export interface ResourceAction {
  id: string;
  text: string;
  /**
   * Rendered only while the action is the active one, so each action owns its own modal
   * and no page-level state has to know which modals exist.
   */
  render: (context: ActionContext) => ReactNode;
  /** AWS keeps single-resource actions disabled until exactly one row is selected. */
  requiresSingle?: boolean;
}

export interface ResourceDefinition {
  title: string;
  description: string;
  filterPlaceholder: string;
  emptyText: string;
  load: (clients: Ec2PageClients) => Promise<Row[]>;
  columns: TableProps.ColumnDefinition<Row>[];
  trackBy: (row: Row) => string;
  /** Create flow. Absent where LCS has no create API for the resource. */
  create?: { label: string; Modal: React.ComponentType<Ec2CreateModalProps> };
  /** Entries for the Actions dropdown. Selection is enabled whenever this is non-empty. */
  actions?: ResourceAction[];
}

/**
 * Builds the delete entry for the Actions menu.
 *
 * Every resource page's delete has the same shape — confirm, call one API per selected
 * row, report which ones failed — so it is described per resource rather than
 * reimplemented. Failures are collected instead of aborting on the first one: EC2 refuses
 * to delete a VPC or security group that is still in use, and stopping early would leave
 * the rest of a multi-row selection silently untouched.
 */
export function deleteAction(options: {
  label: string;
  header: string;
  consequence: string;
  confirmPhrase?: string;
  describe: (row: Row) => string;
  run: (clients: Ec2PageClients, row: Row) => Promise<void>;
}): ResourceAction {
  return {
    id: "delete",
    text: options.label,
    render: ({ rows, clients, onDismiss, onDone }) => (
      <ConfirmDeleteModal
        visible
        onDismiss={onDismiss}
        onDone={onDone}
        header={options.header}
        submitLabel={options.label}
        consequence={options.consequence}
        confirmPhrase={options.confirmPhrase}
        itemLabels={rows.map(options.describe)}
        run={async () => {
          const failures: string[] = [];
          for (const row of rows) {
            try {
              await options.run(clients, row);
            } catch (cause) {
              const { title, detail } = describeAwsError(cause);
              failures.push(`${options.describe(row)} — ${title}: ${detail}`);
            }
          }
          if (failures.length > 0) {
            throw new Error(failures.join("; "));
          }
        }}
      />
    ),
  };
}

/**
 * An in-table link to a resource's detail page.
 *
 * Table cells are plain functions, so they cannot call `useNavigate` themselves. Rendering
 * this component from a cell puts the hook back inside the React tree while keeping the
 * navigation client-side — a bare href would reload the whole console.
 */
export function ResourceLink({ href, children }: { href: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <Link
      href={href}
      onFollow={(event) => {
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </Link>
  );
}

/** Sorts missing values last in ascending order rather than first, as AWS does. */
export function byText(pick: (row: Row) => string | undefined) {
  return (a: Row, b: Row) => (pick(a) ?? "￿").localeCompare(pick(b) ?? "￿");
}

export function byNumber(pick: (row: Row) => number | undefined) {
  return (a: Row, b: Row) =>
    (pick(a) ?? Number.MAX_SAFE_INTEGER) - (pick(b) ?? Number.MAX_SAFE_INTEGER);
}

interface ResourceTablePageProps {
  definition: ResourceDefinition;
  /**
   * Identifies the resource being shown. Changing it resets filter, sort, page, and
   * selection, so a stale selection never survives into a table of different rows.
   */
  resourceKey: string;
}

export function ResourceTablePage({ definition, resourceKey }: ResourceTablePageProps) {
  const clients = useEc2PageClients();
  const { region, accessKeyId } = useEmulator();
  const { notify } = useNotifications();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [filterText, setFilterText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[1]);
  const [wrapLines, setWrapLines] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Row[]>([]);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [sortingColumn, setSortingColumn] = useState<TableProps.SortingColumn<Row> | undefined>(
    undefined,
  );
  const [sortingDescending, setSortingDescending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await definition.load(clients));
      setFailed(false);
      setLoadedAt(new Date());
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load resources — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [clients, definition, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // Switching resource, Region, or account must not carry a stale selection into a table
  // whose rows no longer exist.
  useEffect(() => {
    setSelected([]);
    setActiveActionId(null);
    setFilterText("");
    setCurrentPage(1);
    setSortingColumn(undefined);
  }, [resourceKey, region, accessKeyId]);

  const query = filterText.trim().toLowerCase();
  const matching = rows.filter((row) =>
    query === "" ? true : JSON.stringify(row).toLowerCase().includes(query),
  );
  const comparator = sortingColumn?.sortingComparator;
  const sorted = comparator
    ? [...matching].sort((a, b) => (sortingDescending ? -comparator(a, b) : comparator(a, b)))
    : matching;
  const pageItems = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const actions = definition.actions ?? [];
  const activeAction = actions.find((action) => action.id === activeActionId);
  const CreateModal = definition.create?.Modal;

  const refreshAfterAction = async () => {
    setActiveActionId(null);
    setSelected([]);
    await load();
  };

  return (
    <ContentLayout header={<Header variant="h1">{definition.title}</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText={`Loading ${definition.title.toLowerCase()}`}
        items={pageItems}
        trackBy={definition.trackBy}
        columnDefinitions={definition.columns}
        columnDisplay={
          visibleColumns === null
            ? undefined
            : definition.columns.map((column) => ({
                id: column.id ?? "",
                visible: visibleColumns.includes(column.id ?? ""),
              }))
        }
        wrapLines={wrapLines}
        sortingColumn={sortingColumn}
        sortingDescending={sortingDescending}
        onSortingChange={(event) => {
          setSortingColumn(event.detail.sortingColumn);
          setSortingDescending(event.detail.isDescending ?? false);
        }}
        selectionType={actions.length > 0 ? "multi" : undefined}
        selectedItems={selected}
        onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
        header={
          <Header
            counter={loading ? undefined : `(${rows.length})`}
            description={definition.description}
            actions={
              <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                {/* AWS stamps its inventory tables with when the data was last read, to
                    the left of the refresh control. Without it a stale table and a fresh
                    empty one look identical. */}
                {loadedAt !== null && (
                  <Box variant="small" color="text-body-secondary" textAlign="right">
                    Last updated
                    <br />
                    {loadedAt.toLocaleTimeString()}
                  </Box>
                )}
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                {actions.length > 0 && (
                  <ButtonDropdown
                    items={actions.map((action) => ({
                      id: action.id,
                      text: action.text,
                      disabled:
                        selected.length === 0 ||
                        (action.requiresSingle === true && selected.length !== 1),
                    }))}
                    onItemClick={(event) => setActiveActionId(event.detail.id)}
                  >
                    Actions
                  </ButtonDropdown>
                )}
                {definition.create && (
                  <Button variant="primary" onClick={() => setCreateVisible(true)}>
                    {definition.create.label}
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            {definition.title}
          </Header>
        }
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder={definition.filterPlaceholder}
            filteringAriaLabel={definition.filterPlaceholder}
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
            pagesCount={Math.max(1, Math.ceil(matching.length / pageSize))}
            onChange={(event) => setCurrentPage(event.detail.currentPageIndex)}
          />
        }
        preferences={
          <CollectionPreferences
            title="Preferences"
            confirmLabel="Confirm"
            cancelLabel="Cancel"
            preferences={{
              pageSize,
              wrapLines,
              contentDisplay: definition.columns.map((column) => ({
                id: column.id ?? "",
                visible: visibleColumns === null || visibleColumns.includes(column.id ?? ""),
              })),
            }}
            pageSizePreference={{
              title: "Page size",
              options: PAGE_SIZE_OPTIONS.map((value) => ({
                value,
                label: `${value} resources`,
              })),
            }}
            wrapLinesPreference={{
              label: "Wrap lines",
              description: "Enable to wrap table cell content, disable to truncate text.",
            }}
            contentDisplayPreference={{
              title: "Properties",
              description: "Select visible attribute columns",
              options: definition.columns.map((column) => ({
                id: column.id ?? "",
                label: String(column.header),
                // The row-header column is the resource's identity; AWS pins it too.
                alwaysVisible: column.isRowHeader === true,
              })),
            }}
            onConfirm={(event) => {
              const next = event.detail;
              setPageSize(next.pageSize ?? PAGE_SIZE_OPTIONS[1]);
              setWrapLines(next.wrapLines ?? false);
              setVisibleColumns(
                (next.contentDisplay ?? [])
                  .filter((column) => column.visible)
                  .map((column) => column.id),
              );
              setCurrentPage(1);
            }}
          />
        }
        empty={
          failed ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">Couldn&apos;t load {definition.title.toLowerCase()}</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No {definition.title.toLowerCase()}</Box>
                <Box variant="p" color="text-body-secondary">
                  {definition.emptyText}
                </Box>
                {definition.create && (
                  <Button onClick={() => setCreateVisible(true)}>{definition.create.label}</Button>
                )}
              </SpaceBetween>
            </Box>
          )
        }
      />
      {CreateModal && (
        <CreateModal
          visible={createVisible}
          onDismiss={() => setCreateVisible(false)}
          onCreated={async () => {
            setCreateVisible(false);
            await load();
          }}
        />
      )}
      {activeAction?.render({
        rows: selected,
        clients,
        onDismiss: () => setActiveActionId(null),
        onDone: refreshAfterAction,
      })}
    </ContentLayout>
  );
}
