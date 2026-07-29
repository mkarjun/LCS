import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  DescribeDBSnapshotsCommand,
  RDSClient,
} from "@aws-sdk/client-rds";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";

import { useEmulator } from "@platform/EmulatorContext";
import { useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { CreateDatabaseModal } from "./CreateDatabaseModal";
import { dbStatusIndicator, engineLabel } from "./rdsFormat";

interface DatabaseSummary {
  id: string;
  kind: "cluster" | "instance";
  status?: string;
  engine?: string;
}

/**
 * RDS dashboard — the landing page of the AWS "Aurora and RDS" console.
 *
 * AWS's layout is a Welcome panel with express and full creation paths, a Service overview
 * count row (DB clusters, DB instances, Snapshots, Recent events), and Service health.
 * This keeps that shape. Express configuration is disabled: it provisions an Aurora
 * serverless cluster, which LCS does not model. Recent events is shown as unavailable
 * because DescribeEvents is not implemented, and AWS's RDS costs, Explore Aurora & RDS
 * tutorial, and Recommended services panels are omitted as marketing surfaces with no
 * emulator equivalent.
 */
export default function RdsDashboardPage() {
  const navigate = useNavigate();
  const client = useAwsClient(RDSClient);
  const { region } = useEmulator();

  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [counts, setCounts] = useState({ instances: 0, clusters: 0, snapshots: 0 });
  const [loading, setLoading] = useState(true);
  const [reachable, setReachable] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  useBreadcrumbs([
    { text: "Aurora and RDS", href: "/rds" },
    { text: "Dashboard", href: "/rds" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    const [instances, clusters, snapshots] = await Promise.allSettled([
      client.send(new DescribeDBInstancesCommand({})),
      client.send(new DescribeDBClustersCommand({})),
      client.send(new DescribeDBSnapshotsCommand({})),
    ]);

    const instanceList = instances.status === "fulfilled" ? (instances.value.DBInstances ?? []) : [];
    const clusterList = clusters.status === "fulfilled" ? (clusters.value.DBClusters ?? []) : [];

    // The dashboard's health row reports whether the RDS API answered at all, which is the
    // only service-health signal the emulator can produce honestly.
    setReachable(instances.status === "fulfilled");

    setCounts({
      instances: instanceList.length,
      clusters: clusterList.length,
      snapshots:
        snapshots.status === "fulfilled" ? (snapshots.value.DBSnapshots ?? []).length : 0,
    });

    setDatabases([
      ...clusterList.map((cluster): DatabaseSummary => ({
        id: cluster.DBClusterIdentifier ?? "",
        kind: "cluster",
        status: cluster.Status,
        engine: cluster.Engine,
      })),
      ...instanceList.map((instance): DatabaseSummary => ({
        id: instance.DBInstanceIdentifier ?? "",
        kind: "instance",
        status: instance.DBInstanceStatus,
        engine: instance.Engine,
      })),
    ]);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const count = (label: string, value: number, href: string) => (
    <SpaceBetween size="xxs">
      <Box variant="awsui-key-label">{label}</Box>
      <Link
        href={href}
        variant="awsui-value-large"
        onFollow={(event) => {
          event.preventDefault();
          navigate(href);
        }}
      >
        {String(value)}
      </Link>
    </SpaceBetween>
  );

  /** A count AWS shows that LCS has no API for. Rendered greyed rather than faked. */
  const unavailableCount = (label: string, reason: string) => (
    <SpaceBetween size="xxs">
      <Box variant="awsui-key-label">{label}</Box>
      <Box
        variant="awsui-value-large"
        color="text-status-inactive"
      >
        <span title={`Not available in LCS — ${reason}`}>—</span>
      </Box>
    </SpaceBetween>
  );

  const detailHref = (row: DatabaseSummary) =>
    row.kind === "cluster" ? `/rds/clusters/${row.id}` : `/rds/databases/${row.id}`;

  return (
    <ContentLayout header={<Header variant="h1">Dashboard</Header>}>
      <SpaceBetween size="l">
        <Container
          header={
            <Header
              variant="h2"
              description="Amazon RDS and Amazon Aurora simplify setup and operation of relational databases. LCS runs each one as a real database container you can connect to."
            >
              Welcome to Aurora and RDS
            </Header>
          }
        >
          <ColumnLayout columns={2}>
            <SpaceBetween size="s">
              <Box variant="h3">Create with express configuration in seconds</Box>
              <Box variant="p" color="text-body-secondary">
                AWS creates a pre-configured Aurora serverless database. LCS does not model
                Aurora serverless, so this path is unavailable.
              </Box>
              <Button disabled>Create</Button>
            </SpaceBetween>
            <SpaceBetween size="s">
              <Box variant="h3">Create with full configuration</Box>
              <Box variant="p" color="text-body-secondary">
                Set the engine, version, instance class, networking, and credentials
                yourself. PostgreSQL, MySQL, and MariaDB are backed by real containers.
                Restoring from S3 needs RestoreDBInstanceFromS3, which is not implemented.
              </Box>
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  Create
                </Button>
                <Button disabled>Restore from S3</Button>
              </SpaceBetween>
            </SpaceBetween>
          </ColumnLayout>
        </Container>

        <Container
          header={
            <Header variant="h2" description={`Viewing data from the ${region} Region.`}>
              Service overview
            </Header>
          }
        >
          <ColumnLayout columns={4} variant="text-grid">
            {count("DB clusters", counts.clusters, "/rds/databases")}
            {count("DB instances", counts.instances, "/rds/databases")}
            {count("Snapshots", counts.snapshots, "/rds/databases")}
            {unavailableCount("Recent events", "DescribeEvents is not implemented")}
          </ColumnLayout>
        </Container>

        <Container header={<Header variant="h2">Service health</Header>}>
          <ColumnLayout columns={2} variant="text-grid">
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Current status</Box>
              <Box>
                {reachable ? (
                  <StatusIndicator type="success">
                    Amazon Relational Database Service ({region})
                  </StatusIndicator>
                ) : (
                  <StatusIndicator type="error">
                    Amazon Relational Database Service ({region})
                  </StatusIndicator>
                )}
              </Box>
            </SpaceBetween>
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Details</Box>
              <Box>
                {reachable
                  ? "Service is operating normally"
                  : "The RDS API did not respond to DescribeDBInstances"}
              </Box>
            </SpaceBetween>
          </ColumnLayout>
        </Container>

        <Table
          variant="container"
          loading={loading}
          loadingText="Loading databases"
          items={databases}
          trackBy={(row) => `${row.kind}:${row.id}`}
          header={
            <Header
              variant="h2"
              counter={loading ? undefined : `(${databases.length})`}
              actions={<Button onClick={() => navigate("/rds/databases")}>View all databases</Button>}
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
                <Link
                  href={detailHref(row)}
                  onFollow={(event) => {
                    event.preventDefault();
                    navigate(detailHref(row));
                  }}
                >
                  {row.id}
                </Link>
              ),
            },
            {
              id: "kind",
              header: "Role",
              cell: (row) => (row.kind === "cluster" ? "Regional cluster" : "Instance"),
            },
            { id: "status", header: "Status", cell: (row) => dbStatusIndicator(row.status) },
            { id: "engine", header: "Engine", cell: (row) => engineLabel(row.engine) },
          ]}
          empty={
            <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
              No databases yet.
            </Box>
          }
        />
      </SpaceBetween>

      <CreateDatabaseModal
        visible={createOpen}
        onDismiss={() => setCreateOpen(false)}
        onCreated={async (identifier, kind) => {
          setCreateOpen(false);
          await load();
          navigate(kind === "cluster" ? `/rds/clusters/${identifier}` : `/rds/databases/${identifier}`);
        }}
      />
    </ContentLayout>
  );
}
