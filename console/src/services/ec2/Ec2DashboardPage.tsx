import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DescribeAddressesCommand,
  DescribeInstancesCommand,
  DescribeKeyPairsCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVolumesCommand,
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
import { LaunchInstanceModal } from "./LaunchInstanceModal";
import { useEc2Client } from "./useEc2Client";

interface Counts {
  runningInstances: number;
  instances: number;
  keyPairs: number;
  elasticIps: number;
  securityGroups: number;
  volumes: number;
  vpcs: number;
  subnets: number;
}

/**
 * EC2 dashboard, modelled on the AWS console's "Resources" panel.
 *
 * AWS also shows EC2 cost, instance alarms, and scheduled events. Those require billing
 * and health data the emulator does not produce, so they are omitted rather than filled
 * with invented numbers.
 */
export default function Ec2DashboardPage() {
  const navigate = useNavigate();
  const client = useEc2Client();
  const { region } = useEmulator();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [zones, setZones] = useState<string[]>([]);
  const [launchOpen, setLaunchOpen] = useState(false);

  useBreadcrumbs([{ text: "EC2", href: "/ec2" }]);

  const load = useCallback(async () => {
    const [instances, keys, addresses, groups, volumes, vpcs, subnets] = await Promise.allSettled([
      client.send(new DescribeInstancesCommand({})),
      client.send(new DescribeKeyPairsCommand({})),
      client.send(new DescribeAddressesCommand({})),
      client.send(new DescribeSecurityGroupsCommand({})),
      client.send(new DescribeVolumesCommand({})),
      client.send(new DescribeVpcsCommand({})),
      client.send(new DescribeSubnetsCommand({})),
    ]);

    const allInstances =
      instances.status === "fulfilled"
        ? (instances.value.Reservations ?? []).flatMap((r) => r.Instances ?? [])
        : [];
    const subnetList = subnets.status === "fulfilled" ? (subnets.value.Subnets ?? []) : [];

    setCounts({
      instances: allInstances.length,
      runningInstances: allInstances.filter((i) => i.State?.Name === "running").length,
      keyPairs: keys.status === "fulfilled" ? (keys.value.KeyPairs ?? []).length : 0,
      elasticIps: addresses.status === "fulfilled" ? (addresses.value.Addresses ?? []).length : 0,
      securityGroups:
        groups.status === "fulfilled" ? (groups.value.SecurityGroups ?? []).length : 0,
      volumes: volumes.status === "fulfilled" ? (volumes.value.Volumes ?? []).length : 0,
      vpcs: vpcs.status === "fulfilled" ? (vpcs.value.Vpcs ?? []).length : 0,
      subnets: subnetList.length,
    });

    setZones(
      [...new Set(subnetList.map((s) => s.AvailabilityZone).filter((z): z is string => !!z))].sort(),
    );
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const resource = (label: string, count: number, href: string) => (
    <SpaceBetween size="xxs">
      <Link
        href={href}
        onFollow={(event) => {
          event.preventDefault();
          navigate(href);
        }}
      >
        {label}
      </Link>
      <Box variant="awsui-value-large">{count}</Box>
    </SpaceBetween>
  );

  return (
    <ContentLayout header={<Header variant="h1">EC2 Dashboard</Header>}>
      <SpaceBetween size="l">
        <Container
          header={
            <Header
              variant="h2"
              description={`You are using the following Amazon EC2 resources in the ${region} Region:`}
              actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />}
            >
              Resources
            </Header>
          }
        >
          {counts === null ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <Spinner />
            </Box>
          ) : (
            <ColumnLayout columns={4} variant="text-grid">
              {resource("Instances (running)", counts.runningInstances, "/ec2/instances")}
              {resource("Instances", counts.instances, "/ec2/instances")}
              {resource("Key pairs", counts.keyPairs, "/ec2/key-pairs")}
              {resource("Elastic IPs", counts.elasticIps, "/ec2/elastic-ips")}
              {resource("Security groups", counts.securityGroups, "/ec2/security-groups")}
              {resource("Volumes", counts.volumes, "/ec2/volumes")}
              {resource("VPCs", counts.vpcs, "/ec2/network-interfaces")}
              {resource("Subnets", counts.subnets, "/ec2/network-interfaces")}
            </ColumnLayout>
          )}
        </Container>

        <ColumnLayout columns={2}>
          <Container header={<Header variant="h2">Launch instance</Header>}>
            <SpaceBetween size="m">
              <Box variant="p" color="text-body-secondary">
                To get started, launch an Amazon EC2 instance, which is a virtual server in the
                cloud.
              </Box>
              <Button variant="primary" onClick={() => setLaunchOpen(true)}>
                Launch instance
              </Button>
              <Box variant="small" color="text-body-secondary">
                Your instances will launch in the {region} Region.
              </Box>
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h2">Service health</Header>}>
            <SpaceBetween size="m">
              <SpaceBetween size="xxs">
                <Box variant="awsui-key-label">Region</Box>
                <Box>{region}</Box>
              </SpaceBetween>
              <SpaceBetween size="xxs">
                <Box variant="awsui-key-label">Status</Box>
                <StatusIndicator type="success">
                  This service is operating normally.
                </StatusIndicator>
              </SpaceBetween>
              <Table
                variant="embedded"
                items={zones.map((zone) => ({ zone }))}
                trackBy={(item) => item.zone}
                columnDefinitions={[
                  { id: "zone", header: "Zone name", cell: (item) => item.zone, isRowHeader: true },
                ]}
                empty={
                  <Box textAlign="center" padding={{ vertical: "s" }} color="text-body-secondary">
                    No Availability Zones in use.
                  </Box>
                }
              />
            </SpaceBetween>
          </Container>
        </ColumnLayout>
      </SpaceBetween>

      <LaunchInstanceModal
        visible={launchOpen}
        onDismiss={() => setLaunchOpen(false)}
        onLaunched={async () => {
          setLaunchOpen(false);
          await load();
        }}
      />
    </ContentLayout>
  );
}
