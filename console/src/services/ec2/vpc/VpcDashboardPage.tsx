import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DescribeAddressesCommand,
  DescribeInternetGatewaysCommand,
  DescribeNatGatewaysCommand,
  DescribeNetworkAclsCommand,
  DescribePrefixListsCommand,
  DescribeRouteTablesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVpcEndpointsCommand,
  DescribeVpcsCommand,
} from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Grid from "@cloudscape-design/components/grid";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";

import { useEmulator } from "@platform/EmulatorContext";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { CreateVpcModal } from "../create/CreateVpcModal";
import { useEc2Client } from "../useEc2Client";

interface ResourceCount {
  label: string;
  count: number | null;
  href: string;
}

/**
 * VPC dashboard, modelled on the AWS console's "Resources by Region" panel.
 *
 * Transcribed from the live AWS console on 2026-09-01. Three things that were wrong on the
 * first pass and are corrected here: the panel is "Resources by Region", not "VPCs by
 * Region"; each resource is a card in a two-column grid rather than a cell in one long
 * count row; and there is no "Your VPCs" table on this page — AWS puts the VPC list behind
 * the "VPCs" card.
 *
 * Not reproduced: AWS's per-card "See all regions" disclosure (LCS serves one Region at a
 * time), and the right rail's Settings / Additional Information / Network Manager panels,
 * which link to AWS features and documentation that have no LCS equivalent. Service health
 * is kept, because LCS can actually answer it.
 */
export default function VpcDashboardPage() {
  const navigate = useNavigate();
  const client = useEc2Client();
  const { region } = useEmulator();
  const [counts, setCounts] = useState<ResourceCount[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useBreadcrumbs([{ text: "VPC", href: "/vpc" }]);

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      client.send(new DescribeVpcsCommand({})),
      client.send(new DescribeSubnetsCommand({})),
      client.send(new DescribeRouteTablesCommand({})),
      client.send(new DescribeInternetGatewaysCommand({})),
      client.send(new DescribeAddressesCommand({})),
      client.send(new DescribePrefixListsCommand({})),
      client.send(new DescribeVpcEndpointsCommand({})),
      client.send(new DescribeNatGatewaysCommand({})),
      client.send(new DescribeNetworkAclsCommand({})),
      client.send(new DescribeSecurityGroupsCommand({})),
    ]);

    // A count of null renders as an em dash, not a zero. "This Region has none" and "the
    // emulator could not answer" are different facts and the dashboard must not conflate
    // them — a silent zero is how a broken endpoint looks like an empty account.
    const size = (index: number, pick: (value: never) => unknown[] | undefined): number | null => {
      const result = results[index];
      return result.status === "fulfilled" ? (pick(result.value as never) ?? []).length : null;
    };

    setCounts([
      { label: "VPCs", count: size(0, (v: { Vpcs?: unknown[] }) => v.Vpcs), href: "/vpc/vpcs" },
      {
        label: "Subnets",
        count: size(1, (v: { Subnets?: unknown[] }) => v.Subnets),
        href: "/vpc/subnets",
      },
      {
        label: "Route tables",
        count: size(2, (v: { RouteTables?: unknown[] }) => v.RouteTables),
        href: "/vpc/route-tables",
      },
      {
        label: "Internet gateways",
        count: size(3, (v: { InternetGateways?: unknown[] }) => v.InternetGateways),
        href: "/vpc/internet-gateways",
      },
      {
        label: "Elastic IPs",
        count: size(4, (v: { Addresses?: unknown[] }) => v.Addresses),
        href: "/vpc/elastic-ips",
      },
      {
        label: "Managed prefix lists",
        count: size(5, (v: { PrefixLists?: unknown[] }) => v.PrefixLists),
        href: "/vpc/managed-prefix-lists",
      },
      {
        label: "Endpoints",
        count: size(6, (v: { VpcEndpoints?: unknown[] }) => v.VpcEndpoints),
        href: "/vpc/endpoints",
      },
      {
        label: "NAT gateways",
        count: size(7, (v: { NatGateways?: unknown[] }) => v.NatGateways),
        href: "/vpc/nat-gateways",
      },
      {
        label: "Network ACLs",
        count: size(8, (v: { NetworkAcls?: unknown[] }) => v.NetworkAcls),
        href: "/vpc/network-acls",
      },
      {
        label: "Security groups",
        count: size(9, (v: { SecurityGroups?: unknown[] }) => v.SecurityGroups),
        href: "/vpc/security-groups",
      },
    ]);
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
      <Grid gridDefinition={[{ colspan: { default: 12, m: 8 } }, { colspan: { default: 12, m: 4 } }]}>
        <SpaceBetween size="l">
          {/*
            AWS puts these above the resource panel rather than in its header, with the
            Region note underneath, so a first-time visitor has a create path before they
            have read anything.
          */}
          <SpaceBetween size="xxs">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                Create VPC
              </Button>
              <Button onClick={() => navigate("/ec2/instances")}>Launch EC2 Instances</Button>
            </SpaceBetween>
            <Box variant="small" color="text-body-secondary">
              Note: Your instances will launch in the {region} Region.
            </Box>
          </SpaceBetween>

          <Container
            header={
              <Header
                variant="h2"
                description="You are using the following Amazon VPC resources"
                actions={
                  <Button iconName="refresh" onClick={() => void load()}>
                    Refresh Resources
                  </Button>
                }
              >
                Resources by Region
              </Header>
            }
          >
            {counts === null ? (
              <Box textAlign="center" padding={{ vertical: "l" }}>
                <Spinner />
              </Box>
            ) : (
              <Grid
                gridDefinition={counts.map(() => ({ colspan: { default: 12, xs: 6 } }))}
              >
                {counts.map((entry) => (
                  <div key={entry.label}>
                    <Container>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: "12px",
                        }}
                      >
                        <Link href={entry.href} onFollow={go(entry.href)}>
                          {entry.label}
                        </Link>
                        <Box color="text-body-secondary">
                          {region}{" "}
                          <Box variant="span" fontWeight="bold" color="text-status-info">
                            {entry.count === null ? "—" : entry.count}
                          </Box>
                        </Box>
                      </div>
                    </Container>
                  </div>
                ))}
              </Grid>
            )}
          </Container>
        </SpaceBetween>

        <Container header={<Header variant="h2">Service health</Header>}>
          <SpaceBetween size="m">
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Region</Box>
              <Box>{region}</Box>
            </SpaceBetween>
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Status</Box>
              <StatusIndicator type="success">This service is operating normally.</StatusIndicator>
            </SpaceBetween>
          </SpaceBetween>
        </Container>
      </Grid>

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
