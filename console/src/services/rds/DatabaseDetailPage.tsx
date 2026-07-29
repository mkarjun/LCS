import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  DeleteDBInstanceCommand,
  DescribeDBInstancesCommand,
  ListTagsForResourceCommand,
  RDSClient,
  RebootDBInstanceCommand,
} from "@aws-sdk/client-rds";
import type { DBInstance } from "@aws-sdk/client-rds";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
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
import { ModifyDatabaseModal } from "./ModifyDatabaseModal";
import { dbStatusIndicator, engineLabel, formatStorage } from "./rdsFormat";

/**
 * DB instance detail.
 *
 * AWS's tab set is Connectivity & security, Monitoring, Logs & events, Configuration,
 * Maintenance & backups, and Tags. Monitoring and Logs & events are omitted: RDS here
 * publishes no CloudWatch metrics and no database log files, so both would be permanently
 * empty panels.
 */
export default function DatabaseDetailPage() {
  const { instanceId = "" } = useParams();
  const navigate = useNavigate();
  const client = useAwsClient(RDSClient);
  const { notify } = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();

  const [instance, setInstance] = useState<DBInstance | null>(null);
  const [tags, setTags] = useState<{ key: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [modifyOpen, setModifyOpen] = useState(false);

  const activeTab = searchParams.get("tab") ?? "connectivity";

  useBreadcrumbs([
    { text: "Aurora and RDS", href: "/rds" },
    { text: "Databases", href: "/rds/databases" },
    { text: instanceId, href: `/rds/databases/${instanceId}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(
        new DescribeDBInstancesCommand({ DBInstanceIdentifier: instanceId }),
      );
      const found = response.DBInstances?.[0] ?? null;
      setInstance(found);

      if (found?.DBInstanceArn) {
        try {
          const tagResponse = await client.send(
            new ListTagsForResourceCommand({ ResourceName: found.DBInstanceArn }),
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
      notify({ type: "error", header: `Couldn't load database — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, instanceId, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (action: "reboot" | "delete") => {
    try {
      if (action === "reboot") {
        await client.send(new RebootDBInstanceCommand({ DBInstanceIdentifier: instanceId }));
        notify({ type: "success", content: `Rebooted "${instanceId}".` });
        await load();
      } else {
        await client.send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: instanceId }));
        notify({ type: "success", content: `Deleted "${instanceId}".` });
        navigate("/rds/databases");
      }
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't ${action} database — ${title}`, content: detail });
    }
  };

  if (loading) {
    return (
      <Box textAlign="center" padding={{ vertical: "xxl" }}>
        <Spinner size="large" />
      </Box>
    );
  }

  // A deleted or mistyped identifier would otherwise render the whole page with every
  // field showing an em dash, which reads as a broken database rather than a missing one.
  if (instance === null) {
    return (
      <ContentLayout header={<Header variant="h1">{instanceId}</Header>}>
        <Container>
          <Box textAlign="center" padding={{ vertical: "xl" }}>
            <SpaceBetween size="s">
              <Box variant="strong">Database not found</Box>
              <Box variant="p" color="text-body-secondary">
                No DB instance named "{instanceId}" exists in this Region.
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

  const subnets = instance?.DBSubnetGroup?.Subnets ?? [];

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
              <Button onClick={() => setModifyOpen(true)}>Modify</Button>
              <ButtonDropdown
                items={[
                  { id: "reboot", text: "Reboot" },
                  { id: "delete", text: "Delete" },
                ]}
                onItemClick={(event) => void runAction(event.detail.id as "reboot" | "delete")}
              >
                Actions
              </ButtonDropdown>
            </SpaceBetween>
          }
        >
          {instanceId}
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Summary</Header>}>
          <ColumnLayout columns={4} variant="text-grid">
            {field("DB identifier", instance?.DBInstanceIdentifier ?? "—")}
            {field("Status", dbStatusIndicator(instance?.DBInstanceStatus))}
            {field("Class", instance?.DBInstanceClass ?? "—")}
            {field("Role", instance?.DBClusterIdentifier ? "Cluster instance" : "Instance")}
            {field(
              "Engine",
              instance?.EngineVersion
                ? `${engineLabel(instance.Engine)} ${instance.EngineVersion}`
                : engineLabel(instance?.Engine),
            )}
            {field("Region & AZ", instance?.AvailabilityZone ?? "—")}
            {field("Multi-AZ", instance?.MultiAZ ? "Yes" : "No")}
            {field(
              "Cluster",
              instance?.DBClusterIdentifier ? (
                <Link
                  href={`/rds/clusters/${instance.DBClusterIdentifier}`}
                  onFollow={(event) => {
                    event.preventDefault();
                    navigate(`/rds/clusters/${instance.DBClusterIdentifier}`);
                  }}
                >
                  {instance.DBClusterIdentifier}
                </Link>
              ) : (
                "—"
              ),
            )}
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
                  <Container header={<Header variant="h2">Endpoint & port</Header>}>
                    <SpaceBetween size="m">
                      <ColumnLayout columns={3} variant="text-grid">
                        {field("Endpoint", instance?.Endpoint?.Address ?? "—")}
                        {field("Port", instance?.Endpoint?.Port ?? "—")}
                        {field(
                          "Publicly accessible",
                          instance?.PubliclyAccessible ? "Yes" : "No",
                        )}
                      </ColumnLayout>
                      {instance?.Endpoint?.Port !== undefined && (
                        <Alert type="info">
                          The endpoint address is the database container's address on the
                          Docker network. From the host, connect to{" "}
                          <Box variant="code">localhost:{instance.Endpoint.Port}</Box>.
                        </Alert>
                      )}
                    </SpaceBetween>
                  </Container>

                  <Container header={<Header variant="h2">Networking</Header>}>
                    <ColumnLayout columns={3} variant="text-grid">
                      {field("Availability zone", instance?.AvailabilityZone ?? "—")}
                      {field("VPC", instance?.DBSubnetGroup?.VpcId ?? "—")}
                      {field(
                        "Subnet group",
                        instance?.DBSubnetGroup?.DBSubnetGroupName ? (
                          <Link
                            href="/rds/subnet-groups"
                            onFollow={(event) => {
                              event.preventDefault();
                              navigate("/rds/subnet-groups");
                            }}
                          >
                            {instance.DBSubnetGroup.DBSubnetGroupName}
                          </Link>
                        ) : (
                          "—"
                        ),
                      )}
                      {field(
                        "Subnets",
                        subnets.length === 0
                          ? "—"
                          : subnets.map((subnet) => subnet.SubnetIdentifier).join(", "),
                      )}
                    </ColumnLayout>
                  </Container>

                  <Table
                    variant="container"
                    header={
                      <Header
                        variant="h2"
                        counter={`(${(instance?.VpcSecurityGroups ?? []).length})`}
                      >
                        VPC security groups
                      </Header>
                    }
                    items={instance?.VpcSecurityGroups ?? []}
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

                  <Container header={<Header variant="h2">Security</Header>}>
                    <ColumnLayout columns={3} variant="text-grid">
                      {field(
                        "IAM DB authentication",
                        instance?.IAMDatabaseAuthenticationEnabled ? "Enabled" : "Disabled",
                      )}
                      {field("Master username", instance?.MasterUsername ?? "—")}
                      {field(
                        "Managed master password",
                        instance?.MasterUserSecret?.SecretArn ?? "Not managed",
                      )}
                    </ColumnLayout>
                  </Container>
                </SpaceBetween>
              ),
            },
            {
              id: "configuration",
              label: "Configuration",
              content: (
                <SpaceBetween size="l">
                  <Container header={<Header variant="h2">Instance</Header>}>
                    <ColumnLayout columns={3} variant="text-grid">
                      {field("Engine", engineLabel(instance?.Engine))}
                      {field("Engine version", instance?.EngineVersion ?? "—")}
                      {field("DB instance class", instance?.DBInstanceClass ?? "—")}
                      {field("DB name", instance?.DBName ?? "—")}
                      {field("Storage", formatStorage(instance?.AllocatedStorage))}
                      {field("Storage type", instance?.StorageType ?? "—")}
                    </ColumnLayout>
                  </Container>

                  <Container header={<Header variant="h2">Identifiers</Header>}>
                    <ColumnLayout columns={2} variant="text-grid">
                      {field("ARN", instance?.DBInstanceArn ?? "—")}
                      {field("Resource ID", instance?.DbiResourceId ?? "—")}
                    </ColumnLayout>
                  </Container>

                  <Table
                    variant="container"
                    header={
                      <Header variant="h2">Parameter groups</Header>
                    }
                    items={instance?.DBParameterGroups ?? []}
                    trackBy={(group) => group.DBParameterGroupName ?? ""}
                    columnDefinitions={[
                      {
                        id: "name",
                        header: "Name",
                        isRowHeader: true,
                        cell: (group) => group.DBParameterGroupName ?? "—",
                      },
                      {
                        id: "status",
                        header: "Status",
                        cell: (group) => group.ParameterApplyStatus ?? "—",
                      },
                    ]}
                    empty={
                      <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                        No parameter groups.
                      </Box>
                    }
                  />
                </SpaceBetween>
              ),
            },
            {
              id: "maintenance",
              label: "Maintenance & backups",
              content: (
                <Container header={<Header variant="h2">Maintenance</Header>}>
                  <ColumnLayout columns={2} variant="text-grid">
                    {field(
                      "Maintenance window",
                      instance?.PreferredMaintenanceWindow ?? "—",
                    )}
                    {field("Backup window", instance?.PreferredBackupWindow ?? "—")}
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
                      No tags associated with this database.
                    </Box>
                  }
                />
              ),
            },
          ]}
        />
      </SpaceBetween>

      <ModifyDatabaseModal
        instanceId={modifyOpen ? instanceId : null}
        onDismiss={() => setModifyOpen(false)}
        onModified={async () => {
          setModifyOpen(false);
          await load();
        }}
      />
    </ContentLayout>
  );
}
