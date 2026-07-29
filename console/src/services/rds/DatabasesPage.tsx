import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DeleteDBClusterCommand,
  DeleteDBInstanceCommand,
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  RDSClient,
  RebootDBInstanceCommand,
} from "@aws-sdk/client-rds";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import Toggle from "@cloudscape-design/components/toggle";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { CreateDatabaseModal } from "./CreateDatabaseModal";
import { ModifyDatabaseModal } from "./ModifyDatabaseModal";
import {
  dbStatusIndicator,
  endpointText,
  engineLabel,
  formatStorage,
  unavailableCell,
} from "./rdsFormat";

/**
 * A row in AWS's Databases table. AWS lists clusters and instances together, indenting a
 * cluster's member instances beneath it, so one row type covers both.
 */
export interface DatabaseRow {
  id: string;
  kind: "cluster" | "instance";
  /** AWS's Role column: Regional cluster, Writer instance, Reader instance, or Instance. */
  role: string;
  status?: string;
  engine?: string;
  engineVersion?: string;
  region?: string;
  size?: string;
  storage?: string;
  endpoint: string;
  /** Set on member instances so the table can indent them under their cluster. */
  parentCluster?: string;
}

export default function DatabasesPage() {
  const navigate = useNavigate();
  const client = useAwsClient(RDSClient);
  const { notify } = useNotifications();

  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [selected, setSelected] = useState<DatabaseRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [modifyTarget, setModifyTarget] = useState<DatabaseRow | null>(null);
  const [grouped, setGrouped] = useState(true);

  useBreadcrumbs([
    { text: "Aurora and RDS", href: "/rds" },
    { text: "Databases", href: "/rds/databases" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [clusterResponse, instanceResponse] = await Promise.all([
        client.send(new DescribeDBClustersCommand({})),
        client.send(new DescribeDBInstancesCommand({})),
      ]);
      const clusters = clusterResponse.DBClusters ?? [];
      const instances = instanceResponse.DBInstances ?? [];

      // Writer/reader roles live on the cluster's member list, not on the instance, so
      // build a lookup before mapping the instances.
      const writerIds = new Set(
        clusters.flatMap((cluster) =>
          (cluster.DBClusterMembers ?? [])
            .filter((member) => member.IsClusterWriter)
            .map((member) => member.DBInstanceIdentifier ?? ""),
        ),
      );

      const clusterRows: DatabaseRow[] = clusters.map((cluster) => ({
        id: cluster.DBClusterIdentifier ?? "",
        kind: "cluster",
        role: "Regional cluster",
        status: cluster.Status,
        engine: cluster.Engine,
        engineVersion: cluster.EngineVersion,
        region: cluster.AvailabilityZones?.[0],
        size: `${(cluster.DBClusterMembers ?? []).length} instance(s)`,
        endpoint: endpointText(cluster.Endpoint, cluster.Port),
      }));

      const instanceRows: DatabaseRow[] = instances.map((instance) => ({
        id: instance.DBInstanceIdentifier ?? "",
        kind: "instance",
        role: instance.DBClusterIdentifier
          ? writerIds.has(instance.DBInstanceIdentifier ?? "")
            ? "Writer instance"
            : "Reader instance"
          : "Instance",
        status: instance.DBInstanceStatus,
        engine: instance.Engine,
        engineVersion: instance.EngineVersion,
        region: instance.AvailabilityZone,
        size: instance.DBInstanceClass,
        storage: formatStorage(instance.AllocatedStorage),
        endpoint: endpointText(instance.Endpoint?.Address, instance.Endpoint?.Port),
        parentCluster: instance.DBClusterIdentifier,
      }));

      setRows([...clusterRows, ...instanceRows]);
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load databases — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (action: "reboot" | "delete") => {
    try {
      await Promise.all(
        selected.map((row) => {
          if (action === "reboot") {
            return client.send(new RebootDBInstanceCommand({ DBInstanceIdentifier: row.id }));
          }
          return row.kind === "cluster"
            ? client.send(new DeleteDBClusterCommand({ DBClusterIdentifier: row.id }))
            : client.send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: row.id }));
        }),
      );
      notify({
        type: "success",
        content:
          action === "reboot"
            ? `Rebooted ${selected.length} database(s).`
            : `Deleted ${selected.length} database(s).`,
      });
      setSelected([]);
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't ${action} database — ${title}`, content: detail });
    }
  };

  const detailHref = (row: DatabaseRow) =>
    row.kind === "cluster" ? `/rds/clusters/${row.id}` : `/rds/databases/${row.id}`;

  const query = filterText.trim().toLowerCase();
  const matching = rows.filter((row) =>
    query === "" ? true : row.id.toLowerCase().includes(query),
  );

  // AWS's "Group resources" toggle: on, each cluster is followed by its member instances
  // and standalone instances come last; off, everything is one flat list by identifier.
  const ordered = grouped
    ? [
        ...matching
          .filter((row) => row.kind === "cluster")
          .flatMap((cluster) => [
            cluster,
            ...matching.filter((row) => row.parentCluster === cluster.id),
          ]),
        ...matching.filter((row) => row.kind === "instance" && row.parentCluster === undefined),
      ]
    : [...matching].sort((a, b) => a.id.localeCompare(b.id));

  // Reboot is instance-only; clusters have no RebootDBCluster here.
  const rebootDisabled = selected.length === 0 || selected.some((row) => row.kind === "cluster");
  const modifyDisabled = selected.length !== 1 || selected[0].kind === "cluster";

  return (
    <ContentLayout header={<Header variant="h1">Databases</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading databases"
        items={ordered}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
        trackBy={(row) => `${row.kind}:${row.id}`}
        header={
          <Header
            counter={loading ? undefined : `(${rows.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                <Toggle checked={grouped} onChange={(event) => setGrouped(event.detail.checked)}>
                  Group resources
                </Toggle>
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                <Button
                  disabled={modifyDisabled}
                  onClick={() => setModifyTarget(selected[0])}
                >
                  Modify
                </Button>
                <ButtonDropdown
                  disabled={selected.length === 0}
                  items={[
                    { id: "reboot", text: "Reboot", disabled: rebootDisabled },
                    { id: "delete", text: "Delete" },
                  ]}
                  onItemClick={(event) =>
                    void runAction(event.detail.id as "reboot" | "delete")
                  }
                >
                  Actions
                </ButtonDropdown>
                <ButtonDropdown
                  variant="primary"
                  items={[
                    {
                      id: "express",
                      text: "Express configuration",
                      disabled: true,
                      disabledReason: "LCS does not model Aurora serverless.",
                    },
                    { id: "full", text: "Full configuration" },
                    {
                      id: "restore",
                      text: "Restore from S3",
                      disabled: true,
                      disabledReason: "RestoreDBInstanceFromS3 is not implemented.",
                    },
                  ]}
                  onItemClick={(event) => {
                    if (event.detail.id === "full") {
                      setCreateOpen(true);
                    }
                  }}
                >
                  Create database
                </ButtonDropdown>
              </SpaceBetween>
            }
          >
            Databases
          </Header>
        }
        columnDefinitions={[
          {
            id: "id",
            header: "DB identifier",
            isRowHeader: true,
            cell: (row) => (
              <Box padding={{ left: row.parentCluster ? "l" : "n" }}>
                <Link
                  href={detailHref(row)}
                  onFollow={(event) => {
                    event.preventDefault();
                    navigate(detailHref(row));
                  }}
                >
                  {row.id}
                </Link>
              </Box>
            ),
          },
          { id: "status", header: "Status", cell: (row) => dbStatusIndicator(row.status) },
          { id: "role", header: "Role", cell: (row) => row.role },
          {
            id: "engine",
            header: "Engine",
            cell: (row) =>
              row.engineVersion
                ? `${engineLabel(row.engine)} ${row.engineVersion}`
                : engineLabel(row.engine),
          },
          {
            id: "upgrade",
            header: "Upgrade rollout order",
            cell: () => unavailableCell("engine upgrade schedules are not modelled"),
          },
          { id: "region", header: "Region & AZ", cell: (row) => row.region ?? "—" },
          { id: "size", header: "Size", cell: (row) => row.size ?? "—" },
          { id: "storage", header: "Storage", cell: (row) => row.storage ?? "—" },
          { id: "endpoint", header: "Endpoint", cell: (row) => row.endpoint },
          {
            id: "recommendations",
            header: "Recommendations",
            cell: () => unavailableCell("DescribeDBRecommendations is not implemented"),
          },
          {
            id: "cpu",
            header: "CPU",
            cell: () => unavailableCell("RDS publishes no CloudWatch metrics here"),
          },
          {
            id: "activity",
            header: "Current activity",
            cell: () => unavailableCell("RDS publishes no CloudWatch metrics here"),
          },
          {
            id: "maintenance",
            header: "Maintenance",
            cell: () => unavailableCell("DescribePendingMaintenanceActions is not implemented"),
          },
        ]}
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder="Filter by DB identifier"
            filteringAriaLabel="Filter databases"
            countText={query ? `${matching.length} matches` : ""}
            onChange={(event) => setFilterText(event.detail.filteringText)}
          />
        }
        empty={
          failed ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">Couldn't load databases</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No databases</Box>
                <Box variant="p" color="text-body-secondary">
                  Create a database to get a running engine you can connect to.
                </Box>
                <Button onClick={() => setCreateOpen(true)}>Create database</Button>
              </SpaceBetween>
            </Box>
          )
        }
      />

      <CreateDatabaseModal
        visible={createOpen}
        onDismiss={() => setCreateOpen(false)}
        onCreated={async (identifier, kind) => {
          setCreateOpen(false);
          await load();
          navigate(kind === "cluster" ? `/rds/clusters/${identifier}` : `/rds/databases/${identifier}`);
        }}
      />

      <ModifyDatabaseModal
        instanceId={modifyTarget?.id ?? null}
        onDismiss={() => setModifyTarget(null)}
        onModified={async () => {
          setModifyTarget(null);
          setSelected([]);
          await load();
        }}
      />
    </ContentLayout>
  );
}
