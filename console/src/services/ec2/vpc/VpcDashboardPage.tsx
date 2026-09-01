import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DescribeAddressesCommand,
  DescribeInternetGatewaysCommand,
  DescribeNatGatewaysCommand,
  DescribeNetworkAclsCommand,
  DescribeRouteTablesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVpcEndpointsCommand,
  DescribeVpcsCommand,
} from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";

import { useEmulator } from "@platform/EmulatorContext";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { CreateVpcModal } from "../create/CreateVpcModal";
import { nameTag, useEc2Client } from "../useEc2Client";

interface VpcCount {
  label: string;
  count: number;
  href: string;
}

interface VpcRow {
  id: string;
  name: string;
  cidr: string;
  state: string;
  isDefault: boolean;
}

/**
 * VPC dashboard, modelled on the AWS console's "VPCs by Region" resource panel.
 *
 * AWS also shows a DNS-resolution summary and a "Service health" panel fed by the AWS
 * Health API. LCS produces neither, so the health panel reports only what the emulator
 * can actually attest to — that the service is answering in this Region.
 */
export default function VpcDashboardPage() {
  const navigate = useNavigate();
  const client = useEc2Client();
  const { region } = useEmulator();
  const [counts, setCounts] = useState<VpcCount[] | null>(null);
  const [vpcs, setVpcs] = useState<VpcRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  useBreadcrumbs([{ text: "VPC", href: "/vpc" }]);

  const load = useCallback(async () => {
    const [
      vpcResult,
      subnets,
      routeTables,
      internetGateways,
      natGateways,
      endpoints,
      acls,
      groups,
      addresses,
    ] = await Promise.allSettled([
      client.send(new DescribeVpcsCommand({})),
      client.send(new DescribeSubnetsCommand({})),
      client.send(new DescribeRouteTablesCommand({})),
      client.send(new DescribeInternetGatewaysCommand({})),
      client.send(new DescribeNatGatewaysCommand({})),
      client.send(new DescribeVpcEndpointsCommand({})),
      client.send(new DescribeNetworkAclsCommand({})),
      client.send(new DescribeSecurityGroupsCommand({})),
      client.send(new DescribeAddressesCommand({})),
    ]);

    // Every count is best-effort: one unsupported describe must not blank the dashboard.
    const size = <T,>(result: PromiseSettledResult<T>, pick: (value: T) => unknown[]): number =>
      result.status === "fulfilled" ? pick(result.value).length : 0;

    setCounts([
      { label: "VPCs", count: size(vpcResult, (v) => v.Vpcs ?? []), href: "/vpc/vpcs" },
      { label: "Subnets", count: size(subnets, (v) => v.Subnets ?? []), href: "/vpc/subnets" },
      {
        label: "Route tables",
        count: size(routeTables, (v) => v.RouteTables ?? []),
        href: "/vpc/route-tables",
      },
      {
        label: "Internet gateways",
        count: size(internetGateways, (v) => v.InternetGateways ?? []),
        href: "/vpc/internet-gateways",
      },
      {
        label: "NAT gateways",
        count: size(natGateways, (v) => v.NatGateways ?? []),
        href: "/vpc/nat-gateways",
      },
      {
        label: "Endpoints",
        count: size(endpoints, (v) => v.VpcEndpoints ?? []),
        href: "/vpc/endpoints",
      },
      {
        label: "Network ACLs",
        count: size(acls, (v) => v.NetworkAcls ?? []),
        href: "/vpc/network-acls",
      },
      {
        label: "Security groups",
        count: size(groups, (v) => v.SecurityGroups ?? []),
        href: "/vpc/security-groups",
      },
      {
        label: "Elastic IPs",
        count: size(addresses, (v) => v.Addresses ?? []),
        href: "/vpc/elastic-ips",
      },
    ]);

    setVpcs(
      vpcResult.status === "fulfilled"
        ? (vpcResult.value.Vpcs ?? []).map((vpc) => ({
            id: vpc.VpcId ?? "",
            name: nameTag(vpc.Tags),
            cidr: vpc.CidrBlock ?? "—",
            state: vpc.State ?? "—",
            isDefault: vpc.IsDefault === true,
          }))
        : [],
    );
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const go = (href: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    navigate(href);
  };

  return (
    <ContentLayout header={<Header variant="h1">VPC Dashboard</Header>}>
      <SpaceBetween size="l">
        <Container
          header={
            <Header
              variant="h2"
              description={`You are using the following Amazon VPC resources in the ${region} Region:`}
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                  <Button variant="primary" onClick={() => setCreateOpen(true)}>
                    Create VPC
                  </Button>
                </SpaceBetween>
              }
            >
              VPCs by Region
            </Header>
          }
        >
          {counts === null ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <Spinner />
            </Box>
          ) : (
            <ColumnLayout columns={5} variant="text-grid">
              {counts.map((entry) => (
                <SpaceBetween key={entry.label} size="xxs">
                  <Link href={entry.href} onFollow={go(entry.href)}>
                    {entry.label}
                  </Link>
                  <Box variant="awsui-value-large">{entry.count}</Box>
                </SpaceBetween>
              ))}
            </ColumnLayout>
          )}
        </Container>

        <Table
          variant="container"
          items={vpcs}
          trackBy={(row) => row.id}
          header={
            <Header
              variant="h2"
              counter={`(${vpcs.length})`}
              description="Every VPC in this Region, with its address range."
            >
              Your VPCs
            </Header>
          }
          columnDefinitions={[
            {
              id: "id",
              header: "VPC ID",
              isRowHeader: true,
              cell: (row) => (
                <Link href={`/vpc/vpcs/${row.id}`} onFollow={go(`/vpc/vpcs/${row.id}`)}>
                  {row.id}
                </Link>
              ),
            },
            { id: "name", header: "Name", cell: (row) => row.name },
            { id: "cidr", header: "IPv4 CIDR", cell: (row) => row.cidr },
            {
              id: "state",
              header: "State",
              cell: (row) =>
                row.state === "available" ? (
                  <StatusIndicator type="success">Available</StatusIndicator>
                ) : (
                  <StatusIndicator type="pending">{row.state}</StatusIndicator>
                ),
            },
            { id: "default", header: "Default VPC", cell: (row) => (row.isDefault ? "Yes" : "No") },
          ]}
          empty={
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No VPCs</Box>
                <Box variant="p" color="text-body-secondary">
                  You do not have any VPCs in this Region.
                </Box>
                <Button onClick={() => setCreateOpen(true)}>Create VPC</Button>
              </SpaceBetween>
            </Box>
          }
        />
      </SpaceBetween>

      <CreateVpcModal
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
