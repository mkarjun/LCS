import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  DeleteFlowLogsCommand,
  DeleteVpcCommand,
  DescribeFlowLogsCommand,
  DescribeInternetGatewaysCommand,
  DescribeRouteTablesCommand,
  DescribeSubnetsCommand,
  DescribeVpcAttributeCommand,
  DescribeVpcsCommand,
  ModifyVpcAttributeCommand,
} from "@aws-sdk/client-ec2";
import type { FlowLog, Vpc } from "@aws-sdk/client-ec2";
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
import Toggle from "@cloudscape-design/components/toggle";

import { describeAwsError } from "@platform/awsClient";
import { useEmulator } from "@platform/EmulatorContext";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { ConfirmDeleteModal } from "../ConfirmDeleteModal";
import { ResourceLink } from "../resourceTable";
import { nameTag, useEc2Client } from "../useEc2Client";

/** AWS renders an unset field as an em dash rather than omitting the row. */
function value(input: string | number | boolean | undefined | null): string {
  if (input === undefined || input === null || input === "") {
    return "—";
  }
  return String(input);
}

function field(label: string, content: React.ReactNode) {
  return (
    <SpaceBetween size="xxs">
      <Box variant="awsui-key-label">{label}</Box>
      <Box>{content}</Box>
    </SpaceBetween>
  );
}

interface DnsAttributes {
  dnsSupport: boolean;
  dnsHostnames: boolean;
}

/**
 * `/vpc/vpcs/:vpcId` — the detail view AWS opens when a VPC ID is clicked.
 *
 * AWS's version also carries a Resource map (an interactive topology diagram) and a CIDR
 * reservations tab. Neither is built: the resource map is a rendering of data already on
 * the other tabs, and LCS has no CIDR-reservation API to back the second.
 */
export default function VpcDetailPage() {
  const { vpcId = "" } = useParams();
  const navigate = useNavigate();
  const client = useEc2Client();
  const { notify } = useNotifications();
  const { region, effectiveAccountId } = useEmulator();
  const [searchParams, setSearchParams] = useSearchParams();

  const [vpc, setVpc] = useState<Vpc | null>(null);
  const [dns, setDns] = useState<DnsAttributes | null>(null);
  const [subnetCount, setSubnetCount] = useState<number | null>(null);
  const [routeTableCount, setRouteTableCount] = useState<number | null>(null);
  const [internetGatewayId, setInternetGatewayId] = useState<string | null>(null);
  const [flowLogs, setFlowLogs] = useState<FlowLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingDns, setSavingDns] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const activeTab = searchParams.get("tab") ?? "details";

  useBreadcrumbs([
    { text: "VPC", href: "/vpc" },
    { text: "Your VPCs", href: "/vpc/vpcs" },
    { text: vpcId, href: `/vpc/vpcs/${vpcId}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(new DescribeVpcsCommand({ VpcIds: [vpcId] }));
      setVpc((response.Vpcs ?? [])[0] ?? null);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load VPC — ${title}`, content: detail });
      setVpc(null);
    } finally {
      setLoading(false);
    }

    const filters = [{ Name: "vpc-id", Values: [vpcId] }];
    // Everything below is supporting detail. Each call is settled on its own so a service
    // that cannot answer leaves one field unknown rather than emptying the whole page.
    const [support, hostnames, subnets, routeTables, gateways, logs] = await Promise.allSettled([
      client.send(
        new DescribeVpcAttributeCommand({ VpcId: vpcId, Attribute: "enableDnsSupport" }),
      ),
      client.send(
        new DescribeVpcAttributeCommand({ VpcId: vpcId, Attribute: "enableDnsHostnames" }),
      ),
      client.send(new DescribeSubnetsCommand({ Filters: filters })),
      client.send(new DescribeRouteTablesCommand({ Filters: filters })),
      client.send(new DescribeInternetGatewaysCommand({ Filters: [{ Name: "attachment.vpc-id", Values: [vpcId] }] })),
      client.send(new DescribeFlowLogsCommand({})),
    ]);

    setDns(
      support.status === "fulfilled" && hostnames.status === "fulfilled"
        ? {
            dnsSupport: support.value.EnableDnsSupport?.Value === true,
            dnsHostnames: hostnames.value.EnableDnsHostnames?.Value === true,
          }
        : null,
    );
    setSubnetCount(subnets.status === "fulfilled" ? (subnets.value.Subnets ?? []).length : null);
    setRouteTableCount(
      routeTables.status === "fulfilled" ? (routeTables.value.RouteTables ?? []).length : null,
    );
    setInternetGatewayId(
      gateways.status === "fulfilled"
        ? ((gateways.value.InternetGateways ?? [])[0]?.InternetGatewayId ?? null)
        : null,
    );
    // DescribeFlowLogs has no VPC filter in LCS, so the VPC's own logs are picked out here.
    setFlowLogs(
      logs.status === "fulfilled"
        ? (logs.value.FlowLogs ?? []).filter((log) => log.ResourceId === vpcId)
        : [],
    );
  }, [client, vpcId, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const setDnsAttribute = async (attribute: "dnsSupport" | "dnsHostnames", checked: boolean) => {
    setSavingDns(true);
    try {
      await client.send(
        new ModifyVpcAttributeCommand({
          VpcId: vpcId,
          ...(attribute === "dnsSupport"
            ? { EnableDnsSupport: { Value: checked } }
            : { EnableDnsHostnames: { Value: checked } }),
        }),
      );
      setDns((current) => (current === null ? current : { ...current, [attribute]: checked }));
      notify({
        type: "success",
        content:
          attribute === "dnsSupport"
            ? `DNS resolution ${checked ? "enabled" : "disabled"} for ${vpcId}.`
            : `DNS hostnames ${checked ? "enabled" : "disabled"} for ${vpcId}.`,
      });
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't update DNS settings — ${title}`, content: detail });
      // The toggle showed the new value optimistically; re-read so it matches the API.
      await load();
    } finally {
      setSavingDns(false);
    }
  };

  const deleteFlowLog = async (flowLogId: string) => {
    try {
      await client.send(new DeleteFlowLogsCommand({ FlowLogIds: [flowLogId] }));
      notify({ type: "success", content: `Flow log ${flowLogId} deleted.` });
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't delete flow log — ${title}`, content: detail });
    }
  };

  if (loading && vpc === null) {
    return (
      <Box textAlign="center" padding={{ vertical: "xxl" }}>
        <Spinner size="large" />
      </Box>
    );
  }

  if (vpc === null) {
    return (
      <ContentLayout header={<Header variant="h1">{vpcId}</Header>}>
        <Container>
          <Box textAlign="center" padding={{ vertical: "l" }}>
            <SpaceBetween size="s">
              <Box variant="strong">VPC not found</Box>
              <Box variant="p" color="text-body-secondary">
                {vpcId} does not exist in {region}.
              </Box>
              <Button onClick={() => navigate("/vpc/vpcs")}>Back to Your VPCs</Button>
            </SpaceBetween>
          </Box>
        </Container>
      </ContentLayout>
    );
  }

  const name = nameTag(vpc.Tags);
  const cidrAssociations = vpc.CidrBlockAssociationSet ?? [];

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={name === "—" ? undefined : name}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
              <Button onClick={() => setDeleteOpen(true)}>Delete VPC</Button>
            </SpaceBetween>
          }
        >
          {vpcId}
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">VPC overview</Header>}>
          <ColumnLayout columns={4} variant="text-grid">
            {field(
              "State",
              vpc.State === "available" ? (
                <StatusIndicator type="success">Available</StatusIndicator>
              ) : (
                <StatusIndicator type="pending">{value(vpc.State)}</StatusIndicator>
              ),
            )}
            {field("IPv4 CIDR", value(vpc.CidrBlock))}
            {field("Default VPC", vpc.IsDefault ? "Yes" : "No")}
            {field("Tenancy", value(vpc.InstanceTenancy))}
            {field(
              "Subnets",
              subnetCount === null ? (
                "—"
              ) : (
                <ResourceLink href="/vpc/subnets">{`${subnetCount}`}</ResourceLink>
              ),
            )}
            {field(
              "Route tables",
              routeTableCount === null ? (
                "—"
              ) : (
                <ResourceLink href="/vpc/route-tables">{`${routeTableCount}`}</ResourceLink>
              ),
            )}
            {field(
              "Internet gateway",
              internetGatewayId === null ? (
                "—"
              ) : (
                <ResourceLink href="/vpc/internet-gateways">{internetGatewayId}</ResourceLink>
              ),
            )}
            {field("Owner ID", value(vpc.OwnerId ?? effectiveAccountId))}
          </ColumnLayout>
        </Container>

        <Tabs
          activeTabId={activeTab}
          onChange={(event) => setSearchParams({ tab: event.detail.activeTabId })}
          tabs={[
            {
              id: "details",
              label: "Details",
              content: (
                <Container header={<Header variant="h2">DNS settings</Header>}>
                  {dns === null ? (
                    <Box variant="p" color="text-body-secondary">
                      DNS attributes are unavailable for this VPC.
                    </Box>
                  ) : (
                    <SpaceBetween size="m">
                      <Toggle
                        checked={dns.dnsSupport}
                        disabled={savingDns}
                        onChange={(event) =>
                          void setDnsAttribute("dnsSupport", event.detail.checked)
                        }
                        description="Resolves DNS for instances in the VPC using the Amazon-provided resolver."
                      >
                        DNS resolution
                      </Toggle>
                      <Toggle
                        checked={dns.dnsHostnames}
                        disabled={savingDns}
                        onChange={(event) =>
                          void setDnsAttribute("dnsHostnames", event.detail.checked)
                        }
                        description="Gives instances launched into the VPC a public DNS hostname."
                      >
                        DNS hostnames
                      </Toggle>
                    </SpaceBetween>
                  )}
                </Container>
              ),
            },
            {
              id: "cidrs",
              label: "CIDRs",
              content: (
                <Table
                  variant="container"
                  items={cidrAssociations}
                  trackBy={(row) => row.AssociationId ?? row.CidrBlock ?? ""}
                  header={
                    <Header variant="h2" counter={`(${cidrAssociations.length})`}>
                      IPv4 CIDRs
                    </Header>
                  }
                  columnDefinitions={[
                    {
                      id: "cidr",
                      header: "CIDR",
                      isRowHeader: true,
                      cell: (row) => value(row.CidrBlock),
                    },
                    {
                      id: "association",
                      header: "Association ID",
                      cell: (row) => value(row.AssociationId),
                    },
                    {
                      id: "state",
                      header: "Status",
                      cell: (row) => value(row.CidrBlockState?.State),
                    },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "l" }} color="text-body-secondary">
                      This VPC reports only its primary CIDR block, {value(vpc.CidrBlock)}.
                    </Box>
                  }
                />
              ),
            },
            {
              id: "flow-logs",
              label: "Flow logs",
              content: (
                <Table
                  variant="container"
                  items={flowLogs}
                  trackBy={(row) => row.FlowLogId ?? ""}
                  header={
                    <Header
                      variant="h2"
                      counter={`(${flowLogs.length})`}
                      description="Flow logs capture traffic metadata for the network interfaces in this VPC."
                    >
                      Flow logs
                    </Header>
                  }
                  columnDefinitions={[
                    {
                      id: "id",
                      header: "Flow log ID",
                      isRowHeader: true,
                      cell: (row) => value(row.FlowLogId),
                    },
                    { id: "traffic", header: "Filter", cell: (row) => value(row.TrafficType) },
                    {
                      id: "destinationType",
                      header: "Destination type",
                      cell: (row) => value(row.LogDestinationType),
                    },
                    {
                      id: "destination",
                      header: "Destination",
                      cell: (row) => value(row.LogDestination),
                    },
                    { id: "status", header: "Status", cell: (row) => value(row.FlowLogStatus) },
                    {
                      id: "actions",
                      header: "",
                      cell: (row) => (
                        <Button
                          variant="inline-link"
                          onClick={() => void deleteFlowLog(row.FlowLogId ?? "")}
                        >
                          Delete
                        </Button>
                      ),
                    },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "l" }} color="text-body-secondary">
                      No flow logs for this VPC.
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
                  items={vpc.Tags ?? []}
                  trackBy={(row) => row.Key ?? ""}
                  header={
                    <Header variant="h2" counter={`(${(vpc.Tags ?? []).length})`}>
                      Tags
                    </Header>
                  }
                  columnDefinitions={[
                    { id: "key", header: "Key", isRowHeader: true, cell: (row) => value(row.Key) },
                    { id: "value", header: "Value", cell: (row) => value(row.Value) },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "l" }} color="text-body-secondary">
                      No tags associated with this VPC.
                    </Box>
                  }
                />
              ),
            },
          ]}
        />
      </SpaceBetween>

      {deleteOpen && (
        <ConfirmDeleteModal
          visible
          onDismiss={() => setDeleteOpen(false)}
          onDone={async () => navigate("/vpc/vpcs")}
          header="Delete VPC?"
          submitLabel="Delete VPC"
          consequence="A VPC cannot be deleted while it still contains subnets, gateways, or instances. Delete those first."
          confirmPhrase="delete"
          itemLabels={[`${vpcId} (${value(vpc.CidrBlock)})`]}
          run={async () => {
            await client.send(new DeleteVpcCommand({ VpcId: vpcId }));
          }}
        />
      )}
    </ContentLayout>
  );
}
