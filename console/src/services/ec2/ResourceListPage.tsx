import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  DescribeAddressesCommand,
  DescribeImagesCommand,
  DescribeInstanceTypesCommand,
  DescribeInternetGatewaysCommand,
  DescribeKeyPairsCommand,
  DescribeNetworkInterfacesCommand,
  DescribeRouteTablesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVolumesCommand,
  DescribeVpcsCommand,
} from "@aws-sdk/client-ec2";
import type { EC2Client } from "@aws-sdk/client-ec2";
import {
  DescribeListenersCommand,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  ElasticLoadBalancingV2Client,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
  DescribeLaunchConfigurationsCommand,
} from "@aws-sdk/client-auto-scaling";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import type { TableProps } from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { NotFoundPage } from "@shell/NotFoundPage";
import { nameTag, useEc2Client } from "./useEc2Client";

const PAGE_SIZE = 20;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

/**
 * The EC2 console spans three APIs: EC2 itself, Elastic Load Balancing v2, and Auto
 * Scaling. Pages receive all three so each resource can use whichever it needs.
 */
interface Ec2PageClients {
  ec2: EC2Client;
  elb: ElasticLoadBalancingV2Client;
  autoscaling: AutoScalingClient;
}

interface ResourceDefinition {
  title: string;
  description: string;
  filterPlaceholder: string;
  emptyText: string;
  load: (clients: Ec2PageClients) => Promise<Row[]>;
  columns: TableProps.ColumnDefinition<Row>[];
  trackBy: (row: Row) => string;
}

/**
 * Table-only EC2 resource pages.
 *
 * These share one shape — describe, filter, paginate — so they are defined as data rather
 * than as near-identical components. Instances are excluded: they have row actions and a
 * detail page, so they get their own component.
 */
const RESOURCES: Record<string, ResourceDefinition> = {
  volumes: {
    title: "Volumes",
    description: "Amazon EBS volumes available in this Region.",
    filterPlaceholder: "Find volume",
    emptyText: "You do not have any volumes in this Region.",
    trackBy: (row) => row.VolumeId,
    load: async ({ ec2: client }) => (await client.send(new DescribeVolumesCommand({}))).Volumes ?? [],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true },
      { id: "id", header: "Volume ID", cell: (row) => row.VolumeId ?? "-" },
      { id: "type", header: "Volume type", cell: (row) => row.VolumeType ?? "-" },
      { id: "size", header: "Size", cell: (row) => (row.Size ? `${row.Size} GiB` : "-") },
      { id: "state", header: "Volume state", cell: (row) => row.State ?? "-" },
      { id: "az", header: "Availability Zone", cell: (row) => row.AvailabilityZone ?? "-" },
      {
        id: "attached",
        header: "Attached resources",
        cell: (row) => row.Attachments?.[0]?.InstanceId ?? "—",
      },
    ],
  },
  "security-groups": {
    title: "Security Groups",
    description: "Security groups act as a virtual firewall for your instances.",
    filterPlaceholder: "Find security group",
    emptyText: "You do not have any security groups in this Region.",
    trackBy: (row) => row.GroupId,
    load: async ({ ec2: client }) =>
      (await client.send(new DescribeSecurityGroupsCommand({}))).SecurityGroups ?? [],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true },
      { id: "id", header: "Security group ID", cell: (row) => row.GroupId ?? "-" },
      { id: "groupName", header: "Security group name", cell: (row) => row.GroupName ?? "-" },
      { id: "vpc", header: "VPC ID", cell: (row) => row.VpcId ?? "-" },
      {
        id: "inbound",
        header: "Inbound rules count",
        cell: (row) => `${(row.IpPermissions ?? []).length} rules`,
      },
      {
        id: "outbound",
        header: "Outbound rules count",
        cell: (row) => `${(row.IpPermissionsEgress ?? []).length} rules`,
      },
      { id: "description", header: "Description", cell: (row) => row.Description ?? "-" },
    ],
  },
  "elastic-ips": {
    title: "Elastic IP addresses",
    description: "Static IPv4 addresses designed for dynamic cloud computing.",
    filterPlaceholder: "Find Elastic IP",
    emptyText: "You do not have any Elastic IP addresses in this Region.",
    trackBy: (row) => row.AllocationId ?? row.PublicIp,
    load: async ({ ec2: client }) => (await client.send(new DescribeAddressesCommand({}))).Addresses ?? [],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true },
      { id: "ip", header: "Allocated IPv4 address", cell: (row) => row.PublicIp ?? "-" },
      { id: "allocationId", header: "Allocation ID", cell: (row) => row.AllocationId ?? "-" },
      { id: "type", header: "Type", cell: (row) => row.Domain ?? "-" },
      { id: "instance", header: "Associated instance ID", cell: (row) => row.InstanceId ?? "—" },
      { id: "private", header: "Private IP address", cell: (row) => row.PrivateIpAddress ?? "—" },
    ],
  },
  "key-pairs": {
    title: "Key pairs",
    description: "Key pairs let you connect to your instances securely.",
    filterPlaceholder: "Find key pair",
    emptyText: "You do not have any key pairs in this Region.",
    trackBy: (row) => row.KeyPairId ?? row.KeyName,
    load: async ({ ec2: client }) => (await client.send(new DescribeKeyPairsCommand({}))).KeyPairs ?? [],
    columns: [
      { id: "name", header: "Name", cell: (row) => row.KeyName ?? "-", isRowHeader: true },
      { id: "id", header: "Key pair ID", cell: (row) => row.KeyPairId ?? "-" },
      { id: "type", header: "Type", cell: (row) => row.KeyType ?? "-" },
      { id: "fingerprint", header: "Fingerprint", cell: (row) => row.KeyFingerprint ?? "-" },
    ],
  },
  "network-interfaces": {
    title: "Network interfaces",
    description: "Elastic network interfaces attached to resources in your VPCs.",
    filterPlaceholder: "Find network interface",
    emptyText: "You do not have any network interfaces in this Region.",
    trackBy: (row) => row.NetworkInterfaceId,
    load: async ({ ec2: client }) =>
      (await client.send(new DescribeNetworkInterfacesCommand({}))).NetworkInterfaces ?? [],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.TagSet), isRowHeader: true },
      { id: "id", header: "Network interface ID", cell: (row) => row.NetworkInterfaceId ?? "-" },
      { id: "subnet", header: "Subnet ID", cell: (row) => row.SubnetId ?? "-" },
      { id: "vpc", header: "VPC ID", cell: (row) => row.VpcId ?? "-" },
      { id: "az", header: "Availability Zone", cell: (row) => row.AvailabilityZone ?? "-" },
      { id: "privateIp", header: "Primary private IPv4", cell: (row) => row.PrivateIpAddress ?? "-" },
      { id: "status", header: "Interface status", cell: (row) => row.Status ?? "-" },
    ],
  },
  amis: {
    title: "AMIs",
    description: "Amazon Machine Images available to launch instances from.",
    filterPlaceholder: "Find AMI",
    emptyText: "You do not have any AMIs in this Region.",
    trackBy: (row) => row.ImageId,
    load: async ({ ec2: client }) => (await client.send(new DescribeImagesCommand({}))).Images ?? [],
    columns: [
      { id: "name", header: "AMI name", cell: (row) => row.Name ?? "-", isRowHeader: true },
      { id: "id", header: "AMI ID", cell: (row) => row.ImageId ?? "-" },
      { id: "state", header: "Status", cell: (row) => row.State ?? "-" },
      { id: "arch", header: "Architecture", cell: (row) => row.Architecture ?? "-" },
      { id: "platform", header: "Platform", cell: (row) => row.PlatformDetails ?? "Linux/UNIX" },
      { id: "rootType", header: "Root device type", cell: (row) => row.RootDeviceType ?? "-" },
      { id: "visibility", header: "Visibility", cell: (row) => (row.Public ? "Public" : "Private") },
    ],
  },
  "load-balancers": {
    title: "Load balancers",
    description: "Elastic Load Balancing distributes incoming traffic across multiple targets.",
    filterPlaceholder: "Find load balancer",
    emptyText: "You do not have any load balancers in this Region.",
    trackBy: (row) => row.LoadBalancerArn,
    load: async ({ elb }) =>
      (await elb.send(new DescribeLoadBalancersCommand({}))).LoadBalancers ?? [],
    columns: [
      { id: "name", header: "Name", cell: (row) => row.LoadBalancerName ?? "-", isRowHeader: true },
      { id: "dns", header: "DNS name", cell: (row) => row.DNSName ?? "-" },
      { id: "state", header: "State", cell: (row) => row.State?.Code ?? "-" },
      { id: "type", header: "Type", cell: (row) => row.Type ?? "-" },
      { id: "scheme", header: "Scheme", cell: (row) => row.Scheme ?? "-" },
      { id: "vpc", header: "VPC ID", cell: (row) => row.VpcId ?? "-" },
      {
        id: "azs",
        header: "Availability Zones",
        cell: (row) => (row.AvailabilityZones ?? []).map((z: any) => z.ZoneName).join(", ") || "—",
      },
    ],
  },
  "target-groups": {
    title: "Target groups",
    description: "A target group routes requests to registered targets using a protocol and port.",
    filterPlaceholder: "Find target group",
    emptyText: "You do not have any target groups in this Region.",
    trackBy: (row) => row.TargetGroupArn,
    load: async ({ elb }) =>
      (await elb.send(new DescribeTargetGroupsCommand({}))).TargetGroups ?? [],
    columns: [
      { id: "name", header: "Name", cell: (row) => row.TargetGroupName ?? "-", isRowHeader: true },
      { id: "port", header: "Port", cell: (row) => row.Port ?? "-" },
      { id: "protocol", header: "Protocol", cell: (row) => row.Protocol ?? "-" },
      { id: "targetType", header: "Target type", cell: (row) => row.TargetType ?? "-" },
      { id: "vpc", header: "VPC ID", cell: (row) => row.VpcId ?? "-" },
      {
        id: "lb",
        header: "Load balancer",
        cell: (row) =>
          (row.LoadBalancerArns ?? [])
            .map((arn: string) => arn.split("/")[2] ?? arn)
            .join(", ") || "—",
      },
      {
        id: "health",
        header: "Health check",
        cell: (row) => `${row.HealthCheckProtocol ?? "-"} ${row.HealthCheckPath ?? ""}`.trim(),
      },
    ],
  },
  listeners: {
    title: "Listeners",
    description: "Listeners check for connection requests using the configured protocol and port.",
    filterPlaceholder: "Find listener",
    emptyText: "You do not have any listeners in this Region.",
    trackBy: (row) => row.ListenerArn,
    // DescribeListeners requires a load balancer, so every balancer is walked.
    load: async ({ elb }) => {
      const balancers =
        (await elb.send(new DescribeLoadBalancersCommand({}))).LoadBalancers ?? [];
      const perBalancer = await Promise.all(
        balancers.map(async (balancer) => {
          try {
            const response = await elb.send(
              new DescribeListenersCommand({ LoadBalancerArn: balancer.LoadBalancerArn }),
            );
            return (response.Listeners ?? []).map((listener) => ({
              ...listener,
              loadBalancerName: balancer.LoadBalancerName,
            }));
          } catch {
            return [];
          }
        }),
      );
      return perBalancer.flat();
    },
    columns: [
      {
        id: "protocolPort",
        header: "Protocol:Port",
        cell: (row) => `${row.Protocol ?? "-"}:${row.Port ?? "-"}`,
        isRowHeader: true,
      },
      { id: "lb", header: "Load balancer", cell: (row) => row.loadBalancerName ?? "-" },
      {
        id: "action",
        header: "Default action",
        cell: (row) => {
          const action = (row.DefaultActions ?? [])[0];
          if (!action) {
            return "—";
          }
          const target = action.TargetGroupArn?.split("/")[1];
          return target ? `${action.Type} to ${target}` : (action.Type ?? "—");
        },
      },
      { id: "arn", header: "Listener ARN", cell: (row) => row.ListenerArn ?? "-" },
    ],
  },
  "auto-scaling-groups": {
    title: "Auto Scaling groups",
    description: "An Auto Scaling group maintains a desired number of EC2 instances.",
    filterPlaceholder: "Find Auto Scaling group",
    emptyText: "You do not have any Auto Scaling groups in this Region.",
    trackBy: (row) => row.AutoScalingGroupName,
    load: async ({ autoscaling }) =>
      (await autoscaling.send(new DescribeAutoScalingGroupsCommand({}))).AutoScalingGroups ?? [],
    columns: [
      {
        id: "name",
        header: "Name",
        cell: (row) => row.AutoScalingGroupName ?? "-",
        isRowHeader: true,
      },
      {
        id: "launchTemplate",
        header: "Launch template/configuration",
        cell: (row) => row.LaunchConfigurationName ?? row.LaunchTemplate?.LaunchTemplateName ?? "—",
      },
      {
        id: "instances",
        header: "Instances",
        cell: (row) => String((row.Instances ?? []).length),
      },
      { id: "desired", header: "Desired capacity", cell: (row) => row.DesiredCapacity ?? "-" },
      { id: "min", header: "Min", cell: (row) => row.MinSize ?? "-" },
      { id: "max", header: "Max", cell: (row) => row.MaxSize ?? "-" },
      {
        id: "azs",
        header: "Availability Zones",
        cell: (row) => (row.AvailabilityZones ?? []).join(", ") || "—",
      },
    ],
  },
  "launch-configurations": {
    title: "Launch configurations",
    description: "A launch configuration is a template an Auto Scaling group uses to launch instances.",
    filterPlaceholder: "Find launch configuration",
    emptyText: "You do not have any launch configurations in this Region.",
    trackBy: (row) => row.LaunchConfigurationName,
    load: async ({ autoscaling }) =>
      (await autoscaling.send(new DescribeLaunchConfigurationsCommand({})))
        .LaunchConfigurations ?? [],
    columns: [
      {
        id: "name",
        header: "Name",
        cell: (row) => row.LaunchConfigurationName ?? "-",
        isRowHeader: true,
      },
      { id: "ami", header: "AMI ID", cell: (row) => row.ImageId ?? "-" },
      { id: "type", header: "Instance type", cell: (row) => row.InstanceType ?? "-" },
      { id: "key", header: "Key name", cell: (row) => row.KeyName ?? "—" },
      {
        id: "created",
        header: "Creation time",
        cell: (row) => (row.CreatedTime ? new Date(row.CreatedTime).toLocaleString() : "—"),
      },
    ],
  },
  vpcs: {
    title: "Your VPCs",
    description: "A VPC is an isolated portion of the cloud populated by AWS objects.",
    filterPlaceholder: "Find VPC",
    emptyText: "You do not have any VPCs in this Region.",
    trackBy: (row) => row.VpcId,
    load: async ({ ec2: client }) => (await client.send(new DescribeVpcsCommand({}))).Vpcs ?? [],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true },
      { id: "id", header: "VPC ID", cell: (row) => row.VpcId ?? "-" },
      { id: "state", header: "State", cell: (row) => row.State ?? "-" },
      { id: "cidr", header: "IPv4 CIDR", cell: (row) => row.CidrBlock ?? "-" },
      { id: "default", header: "Default VPC", cell: (row) => (row.IsDefault ? "Yes" : "No") },
      { id: "tenancy", header: "Tenancy", cell: (row) => row.InstanceTenancy ?? "-" },
    ],
  },
  subnets: {
    title: "Subnets",
    description: "A subnet is a range of IP addresses in your VPC.",
    filterPlaceholder: "Find subnet",
    emptyText: "You do not have any subnets in this Region.",
    trackBy: (row) => row.SubnetId,
    load: async ({ ec2: client }) =>
      (await client.send(new DescribeSubnetsCommand({}))).Subnets ?? [],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true },
      { id: "id", header: "Subnet ID", cell: (row) => row.SubnetId ?? "-" },
      { id: "state", header: "State", cell: (row) => row.State ?? "-" },
      { id: "vpc", header: "VPC", cell: (row) => row.VpcId ?? "-" },
      { id: "cidr", header: "IPv4 CIDR", cell: (row) => row.CidrBlock ?? "-" },
      {
        id: "available",
        header: "Available IPv4 addresses",
        cell: (row) => row.AvailableIpAddressCount ?? "-",
      },
      { id: "az", header: "Availability Zone", cell: (row) => row.AvailabilityZone ?? "-" },
    ],
  },
  "route-tables": {
    title: "Route tables",
    description: "A route table contains rules that determine where network traffic is directed.",
    filterPlaceholder: "Find route table",
    emptyText: "You do not have any route tables in this Region.",
    trackBy: (row) => row.RouteTableId,
    load: async ({ ec2: client }) =>
      (await client.send(new DescribeRouteTablesCommand({}))).RouteTables ?? [],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true },
      { id: "id", header: "Route table ID", cell: (row) => row.RouteTableId ?? "-" },
      { id: "vpc", header: "VPC", cell: (row) => row.VpcId ?? "-" },
      { id: "routes", header: "Routes", cell: (row) => String((row.Routes ?? []).length) },
      {
        id: "assoc",
        header: "Explicit subnet associations",
        cell: (row) =>
          (row.Associations ?? [])
            .map((a: any) => a.SubnetId)
            .filter(Boolean)
            .join(", ") || "—",
      },
      {
        id: "main",
        header: "Main",
        cell: (row) => ((row.Associations ?? []).some((a: any) => a.Main) ? "Yes" : "No"),
      },
    ],
  },
  "internet-gateways": {
    title: "Internet gateways",
    description: "An internet gateway allows communication between your VPC and the internet.",
    filterPlaceholder: "Find internet gateway",
    emptyText: "You do not have any internet gateways in this Region.",
    trackBy: (row) => row.InternetGatewayId,
    load: async ({ ec2: client }) =>
      (await client.send(new DescribeInternetGatewaysCommand({}))).InternetGateways ?? [],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true },
      { id: "id", header: "Internet gateway ID", cell: (row) => row.InternetGatewayId ?? "-" },
      {
        id: "state",
        header: "State",
        cell: (row) => (row.Attachments ?? [])[0]?.State ?? "detached",
      },
      {
        id: "vpc",
        header: "VPC ID",
        cell: (row) => (row.Attachments ?? [])[0]?.VpcId ?? "—",
      },
    ],
  },
  "instance-types": {
    title: "Instance types",
    description: "Instance types available for launching instances in this Region.",
    filterPlaceholder: "Find instance type",
    emptyText: "No instance types returned for this Region.",
    trackBy: (row) => row.InstanceType,
    load: async ({ ec2: client }) =>
      (await client.send(new DescribeInstanceTypesCommand({ MaxResults: 100 }))).InstanceTypes ?? [],
    columns: [
      { id: "type", header: "Instance type", cell: (row) => row.InstanceType ?? "-", isRowHeader: true },
      { id: "vcpu", header: "vCPUs", cell: (row) => row.VCpuInfo?.DefaultVCpus ?? "-" },
      {
        id: "memory",
        header: "Memory (GiB)",
        cell: (row) => (row.MemoryInfo?.SizeInMiB ? row.MemoryInfo.SizeInMiB / 1024 : "-"),
      },
      {
        id: "storage",
        header: "Instance storage",
        cell: (row) => (row.InstanceStorageSupported ? "Yes" : "EBS only"),
      },
      {
        id: "network",
        header: "Network performance",
        cell: (row) => row.NetworkInfo?.NetworkPerformance ?? "-",
      },
    ],
  },
};

export default function ResourceListPage() {
  const { resource = "" } = useParams();
  const definition = RESOURCES[resource];
  const ec2 = useEc2Client();
  const elb = useAwsClient(ElasticLoadBalancingV2Client);
  const autoscaling = useAwsClient(AutoScalingClient);
  const { notify } = useNotifications();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useBreadcrumbs(
    definition
      ? [
          { text: "EC2", href: "/ec2" },
          { text: definition.title, href: `/ec2/${resource}` },
        ]
      : [],
  );

  const load = useCallback(async () => {
    if (!definition) {
      return;
    }
    setLoading(true);
    try {
      setRows(await definition.load({ ec2, elb, autoscaling }));
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load resources — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [ec2, elb, autoscaling, definition, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!definition) {
    return <NotFoundPage />;
  }

  const query = filterText.trim().toLowerCase();
  const matching = rows.filter((row) =>
    query === "" ? true : JSON.stringify(row).toLowerCase().includes(query),
  );
  const pageItems = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <ContentLayout header={<Header variant="h1">{definition.title}</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText={`Loading ${definition.title.toLowerCase()}`}
        items={pageItems}
        trackBy={definition.trackBy}
        columnDefinitions={definition.columns}
        header={
          <Header
            counter={loading ? undefined : `(${rows.length})`}
            description={definition.description}
            actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />}
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
            pagesCount={Math.max(1, Math.ceil(matching.length / PAGE_SIZE))}
            onChange={(event) => setCurrentPage(event.detail.currentPageIndex)}
          />
        }
        empty={
          failed ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">Couldn't load {definition.title.toLowerCase()}</Box>
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
              </SpaceBetween>
            </Box>
          )
        }
      />
    </ContentLayout>
  );
}
