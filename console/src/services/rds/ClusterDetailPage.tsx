import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  DeleteDBClusterCommand,
  DescribeDBClustersCommand,
  ListTagsForResourceCommand,
  RDSClient,
} from "@aws-sdk/client-rds";
import type { DBCluster } from "@aws-sdk/client-rds";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import type { ReactNode } from "react";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { dbStatusIndicator, endpointText, engineLabel } from "./rdsFormat";

/**
 * DB cluster detail.
 *
 * A cluster's own API surface is smaller than an instance's: there is no reboot, and
 * ModifyDBCluster takes only the master password and IAM authentication flag, so the page
 * offers Delete alongside the read views rather than a modify form that would cover two
 * fields.
 */
export default function ClusterDetailPage() {
  const { clusterId = "" } = useParams();
  const navigate = useNavigate();
  const client = useAwsClient(RDSClient);
  const { notify } = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();

  const [cluster, setCluster] = useState<DBCluster | null>(null);
  const [tags, setTags] = useState<{ key: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const activeTab = searchParams.get("tab") ?? "connectivity";

  useBreadcrumbs([
    { text: "Aurora and RDS", href: "/rds" },
    { text: "Databases", href: "/rds/databases" },
    { text: clusterId, href: `/rds/clusters/${clusterId}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(
        new DescribeDBClustersCommand({ DBClusterIdentifier: clusterId }),
      );
      const found = response.DBClusters?.[0] ?? null;
      setCluster(found);

      if (found?.DBClusterArn) {
        try {
          const tagResponse = await client.send(
            new ListTagsForResourceCommand({ ResourceName: found.DBClusterArn }),
          );
          setTags(
            (tagResponse.TagList ?? []).map((tag) => ({
              key: tag.Key ?? "",
              value: tag.Value ?? "",
            })),
          );
        } catch {
          setTags([]);
        }
      }
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load cluster — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, clusterId, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    try {
      await client.send(new DeleteDBClusterCommand({ DBClusterIdentifier: clusterId }));
      notify({ type: "success", content: `Deleted cluster "${clusterId}".` });
      navigate("/rds/databases");
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't delete cluster — ${title}`, content: detail });
    }
  };

  if (loading) {
    return (
      <Box textAlign="center" padding={{ vertical: "xxl" }}>
        <Spinner size="large" />
      </Box>
    );
  }

  // See DatabaseDetailPage: a missing cluster should say so, not render every field blank.
  if (cluster === null) {
    return (
      <ContentLayout header={<Header variant="h1">{clusterId}</Header>}>
        <Container>
          <Box textAlign="center" padding={{ vertical: "xl" }}>
            <SpaceBetween size="s">
              <Box variant="strong">Cluster not found</Box>
              <Box variant="p" color="text-body-secondary">
                No DB cluster named "{clusterId}" exists in this Region.
              </Box>
              <Button onClick={() => navigate("/rds/databases")}>Back to Databases</Button>
            </SpaceBetween>
          </Box>
        </Container>
      </ContentLayout>
    );
  }

  const field = (label: string, content: ReactNode) => (
    <SpaceBetween size="xxs">
      <Box variant="awsui-key-label">{label}</Box>
      <Box>{content}</Box>
    </SpaceBetween>
  );

  const members = cluster?.DBClusterMembers ?? [];

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
              <Button onClick={() => void remove()}>Delete</Button>
            </SpaceBetween>
          }
        >
          {clusterId}
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Summary</Header>}>
          <ColumnLayout columns={4} variant="text-grid">
            {field("Cluster identifier", cluster?.DBClusterIdentifier ?? "—")}
            {field("Status", dbStatusIndicator(cluster?.Status))}
            {field(
              "Engine",
              cluster?.EngineVersion
                ? `${engineLabel(cluster.Engine)} ${cluster.EngineVersion}`
                : engineLabel(cluster?.Engine),
            )}
            {field("Instances", String(members.length))}
            {field("Multi-AZ", cluster?.MultiAZ ? "Yes" : "No")}
            {field("Master username", cluster?.MasterUsername ?? "—")}
            {field("Subnet group", cluster?.DBSubnetGroup ?? "—")}
            {field("ARN", cluster?.DBClusterArn ?? "—")}
          </ColumnLayout>
        </Container>

        <Tabs
          activeTabId={activeTab}
          onChange={(event) => setSearchParams({ tab: event.detail.activeTabId })}
          tabs={[
            {
              id: "connectivity",
              label: "Connectivity & security",
              content: (
                <SpaceBetween size="l">
                  <Container header={<Header variant="h2">Endpoints</Header>}>
                    <SpaceBetween size="m">
                      <ColumnLayout columns={3} variant="text-grid">
                        {field("Writer endpoint", endpointText(cluster?.Endpoint, cluster?.Port))}
                        {field(
                          "Reader endpoint",
                          endpointText(cluster?.ReaderEndpoint, cluster?.Port),
                        )}
                        {field(
                          "IAM DB authentication",
                          cluster?.IAMDatabaseAuthenticationEnabled ? "Enabled" : "Disabled",
                        )}
                      </ColumnLayout>
                      {cluster?.Port !== undefined && (
                        <Alert type="info">
                          The endpoint address is the database container's address on the
                          Docker network. From the host, connect to{" "}
                          <Box variant="code">localhost:{cluster.Port}</Box>.
                        </Alert>
                      )}
                    </SpaceBetween>
                  </Container>

                  <Table
                    variant="container"
                    header={
                      <Header
                        variant="h2"
                        counter={`(${(cluster?.VpcSecurityGroups ?? []).length})`}
                      >
                        VPC security groups
                      </Header>
                    }
                    items={cluster?.VpcSecurityGroups ?? []}
                    trackBy={(group) => group.VpcSecurityGroupId ?? ""}
                    columnDefinitions={[
                      {
                        id: "id",
                        header: "Security group",
                        isRowHeader: true,
                        cell: (group) => group.VpcSecurityGroupId ?? "—",
                      },
                      { id: "status", header: "Status", cell: (group) => group.Status ?? "—" },
                    ]}
                    empty={
                      <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                        No security groups.
                      </Box>
                    }
                  />
                </SpaceBetween>
              ),
            },
            {
              id: "members",
              label: "Instances",
              content: (
                <Table
                  variant="container"
                  header={
                    <Header variant="h2" counter={`(${members.length})`}>
                      Cluster instances
                    </Header>
                  }
                  items={members}
                  trackBy={(member) => member.DBInstanceIdentifier ?? ""}
                  columnDefinitions={[
                    {
                      id: "id",
                      header: "DB identifier",
                      isRowHeader: true,
                      cell: (member) => (
                        <Link
                          href={`/rds/databases/${member.DBInstanceIdentifier}`}
                          onFollow={(event) => {
                            event.preventDefault();
                            navigate(`/rds/databases/${member.DBInstanceIdentifier}`);
                          }}
                        >
                          {member.DBInstanceIdentifier}
                        </Link>
                      ),
                    },
                    {
                      id: "role",
                      header: "Role",
                      cell: (member) => (member.IsClusterWriter ? "Writer" : "Reader"),
                    },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "l" }}>
                      <SpaceBetween size="s">
                        <Box variant="strong">No instances in this cluster</Box>
                        <Box variant="p" color="text-body-secondary">
                          Create a database and set its cluster to {clusterId} to add one.
                        </Box>
                      </SpaceBetween>
                    </Box>
                  }
                />
              ),
            },
            {
              id: "maintenance",
              label: "Maintenance & backups",
              content: (
                <Container header={<Header variant="h2">Maintenance</Header>}>
                  <ColumnLayout columns={2} variant="text-grid">
                    {field("Maintenance window", cluster?.PreferredMaintenanceWindow ?? "—")}
                    {field("Backup window", cluster?.PreferredBackupWindow ?? "—")}
                  </ColumnLayout>
                </Container>
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
                      No tags associated with this cluster.
                    </Box>
                  }
                />
              ),
            },
          ]}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}
