import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import {
  DeleteInternetGatewayCommand,
  DeleteKeyPairCommand,
  DeleteRouteTableCommand,
  DeleteSecurityGroupCommand,
  DeleteSubnetCommand,
  DeleteVolumeCommand,
  DeleteVpcCommand,
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
  ReleaseAddressCommand,
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
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import type { TableProps } from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useEmulator } from "@platform/EmulatorContext";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { NotFoundPage } from "@shell/NotFoundPage";
import { nameTag, useEc2Client } from "./useEc2Client";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { EditSecurityGroupRulesModal } from "./EditSecurityGroupRulesModal";
import { AllocateAddressModal } from "./create/AllocateAddressModal";
import { CreateInternetGatewayModal } from "./create/CreateInternetGatewayModal";
import { CreateKeyPairModal } from "./create/CreateKeyPairModal";
import { CreateRouteTableModal } from "./create/CreateRouteTableModal";
import { CreateSecurityGroupModal } from "./create/CreateSecurityGroupModal";
import { CreateSubnetModal } from "./create/CreateSubnetModal";
import { CreateVolumeModal } from "./create/CreateVolumeModal";
import { CreateVpcModal } from "./create/CreateVpcModal";
import type { Ec2CreateModalProps } from "./create/createForm";

const PAGE_SIZE_OPTIONS = [10, 25, 50];

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

/** Everything an action needs to run and then refresh the table behind it. */
interface ActionContext {
  rows: Row[];
  clients: Ec2PageClients;
  onDismiss: () => void;
  onDone: () => Promise<void>;
}

interface ResourceAction {
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

interface ResourceDefinition {
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
function deleteAction(options: {
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
 * Table-only EC2 resource pages.
 *
 * These share one shape — describe, filter, sort, paginate, create, delete — so they are
 * defined as data rather than as near-identical components. Instances are excluded: they
 * have row actions and a detail page, so they get their own component.
 */
const RESOURCES: Record<string, ResourceDefinition> = {
  volumes: {
    title: "Volumes",
    description: "Amazon EBS volumes available in this Region.",
    filterPlaceholder: "Find volume",
    emptyText: "You do not have any volumes in this Region.",
    trackBy: (row) => row.VolumeId,
    load: async ({ ec2: client }) => (await client.send(new DescribeVolumesCommand({}))).Volumes ?? [],
    create: { label: "Create volume", Modal: CreateVolumeModal },
    actions: [
      deleteAction({
        label: "Delete volume",
        header: "Delete volume?",
        consequence:
          "Deleting a volume permanently destroys the data on it. A volume that is attached to an instance must be detached first.",
        confirmPhrase: "delete",
        describe: (row) => `${row.VolumeId} (${row.Size} GiB, ${row.State})`,
        run: async ({ ec2 }, row) =>
          void (await ec2.send(new DeleteVolumeCommand({ VolumeId: row.VolumeId }))),
      }),
    ],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true, sortingComparator: byText((row) => nameTag(row.Tags)) },
      { id: "id", header: "Volume ID", cell: (row) => row.VolumeId ?? "-", sortingComparator: byText((row) => row.VolumeId) },
      { id: "type", header: "Volume type", cell: (row) => row.VolumeType ?? "-", sortingComparator: byText((row) => row.VolumeType) },
      { id: "size", header: "Size", cell: (row) => (row.Size ? `${row.Size} GiB` : "-"), sortingComparator: byNumber((row) => row.Size) },
      { id: "state", header: "Volume state", cell: (row) => row.State ?? "-", sortingComparator: byText((row) => row.State) },
      { id: "az", header: "Availability Zone", cell: (row) => row.AvailabilityZone ?? "-", sortingComparator: byText((row) => row.AvailabilityZone) },
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
    filterPlaceholder: "Find security groups by attribute or tag",
    emptyText: "You do not have any security groups in this Region.",
    trackBy: (row) => row.GroupId,
    load: async ({ ec2: client }) =>
      (await client.send(new DescribeSecurityGroupsCommand({}))).SecurityGroups ?? [],
    create: { label: "Create security group", Modal: CreateSecurityGroupModal },
    actions: [
      {
        id: "edit-inbound",
        text: "Edit inbound rules",
        requiresSingle: true,
        render: ({ rows, clients, onDismiss, onDone }) => (
          <EditSecurityGroupRulesModal
            visible
            onDismiss={onDismiss}
            onDone={onDone}
            client={clients.ec2}
            group={rows[0]}
            direction="inbound"
          />
        ),
      },
      {
        id: "edit-outbound",
        text: "Edit outbound rules",
        requiresSingle: true,
        render: ({ rows, clients, onDismiss, onDone }) => (
          <EditSecurityGroupRulesModal
            visible
            onDismiss={onDismiss}
            onDone={onDone}
            client={clients.ec2}
            group={rows[0]}
            direction="outbound"
          />
        ),
      },
      deleteAction({
        label: "Delete security group",
        header: "Delete security group?",
        consequence:
          "A security group cannot be deleted while it is attached to an instance or referenced by another group. The default group of a VPC cannot be deleted at all.",
        describe: (row) => `${row.GroupId} (${row.GroupName})`,
        run: async ({ ec2 }, row) =>
          void (await ec2.send(new DeleteSecurityGroupCommand({ GroupId: row.GroupId }))),
      }),
    ],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true, sortingComparator: byText((row) => nameTag(row.Tags)) },
      { id: "id", header: "Security group ID", cell: (row) => row.GroupId ?? "-", sortingComparator: byText((row) => row.GroupId) },
      { id: "groupName", header: "Security group name", cell: (row) => row.GroupName ?? "-", sortingComparator: byText((row) => row.GroupName) },
      { id: "vpc", header: "VPC ID", cell: (row) => row.VpcId ?? "-", sortingComparator: byText((row) => row.VpcId) },
      { id: "description", header: "Description", cell: (row) => row.Description ?? "-", sortingComparator: byText((row) => row.Description) },
      { id: "owner", header: "Owner", cell: (row) => row.OwnerId ?? "—", sortingComparator: byText((row) => row.OwnerId) },
      {
        id: "inbound",
        // AWS counts permission entries, not rules — one rule with three CIDRs is three.
        header: "Inbound rules count",
        cell: (row) => permissionEntries(row.IpPermissions),
        sortingComparator: byNumber((row) => countEntries(row.IpPermissions)),
      },
      {
        id: "outbound",
        header: "Outbound rules count",
        cell: (row) => permissionEntries(row.IpPermissionsEgress),
        sortingComparator: byNumber((row) => countEntries(row.IpPermissionsEgress)),
      },
    ],
  },
  "elastic-ips": {
    title: "Elastic IP addresses",
    description: "Static IPv4 addresses designed for dynamic cloud computing.",
    filterPlaceholder: "Find Elastic IP",
    emptyText: "You do not have any Elastic IP addresses in this Region.",
    trackBy: (row) => row.AllocationId ?? row.PublicIp,
    load: async ({ ec2: client }) => (await client.send(new DescribeAddressesCommand({}))).Addresses ?? [],
    create: { label: "Allocate Elastic IP address", Modal: AllocateAddressModal },
    actions: [
      deleteAction({
        label: "Release Elastic IP addresses",
        header: "Release Elastic IP addresses?",
        consequence:
          "Released addresses return to the pool and cannot be reclaimed. An address that is associated with an instance must be disassociated first.",
        describe: (row) => `${row.PublicIp} (${row.AllocationId})`,
        run: async ({ ec2 }, row) =>
          void (await ec2.send(new ReleaseAddressCommand({ AllocationId: row.AllocationId }))),
      }),
    ],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true, sortingComparator: byText((row) => nameTag(row.Tags)) },
      { id: "ip", header: "Allocated IPv4 address", cell: (row) => row.PublicIp ?? "-", sortingComparator: byText((row) => row.PublicIp) },
      { id: "allocationId", header: "Allocation ID", cell: (row) => row.AllocationId ?? "-", sortingComparator: byText((row) => row.AllocationId) },
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
    create: { label: "Create key pair", Modal: CreateKeyPairModal },
    actions: [
      deleteAction({
        label: "Delete key pair",
        header: "Delete key pair?",
        consequence:
          "Deleting a key pair does not change instances already launched with it, but the key can no longer be used for new launches.",
        confirmPhrase: "delete",
        describe: (row) => `${row.KeyName} (${row.KeyPairId})`,
        run: async ({ ec2 }, row) =>
          void (await ec2.send(new DeleteKeyPairCommand({ KeyPairId: row.KeyPairId }))),
      }),
    ],
    columns: [
      { id: "name", header: "Name", cell: (row) => row.KeyName ?? "-", isRowHeader: true, sortingComparator: byText((row) => row.KeyName) },
      { id: "id", header: "Key pair ID", cell: (row) => row.KeyPairId ?? "-", sortingComparator: byText((row) => row.KeyPairId) },
      { id: "type", header: "Type", cell: (row) => row.KeyType ?? "-", sortingComparator: byText((row) => row.KeyType) },
      { id: "fingerprint", header: "Fingerprint", cell: (row) => row.KeyFingerprint ?? "-" },
      {
        id: "created",
        header: "Created",
        cell: (row) => (row.CreateTime ? new Date(row.CreateTime).toLocaleString() : "—"),
        sortingComparator: byNumber((row) => (row.CreateTime ? new Date(row.CreateTime).getTime() : 0)),
      },
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
    // No create flow: LCS implements neither CreateNetworkInterface nor
    // DeleteNetworkInterface. Interfaces exist only as a side effect of RunInstances.
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.TagSet), isRowHeader: true, sortingComparator: byText((row) => nameTag(row.TagSet)) },
      { id: "id", header: "Network interface ID", cell: (row) => row.NetworkInterfaceId ?? "-", sortingComparator: byText((row) => row.NetworkInterfaceId) },
      { id: "subnet", header: "Subnet ID", cell: (row) => row.SubnetId ?? "-", sortingComparator: byText((row) => row.SubnetId) },
      { id: "vpc", header: "VPC ID", cell: (row) => row.VpcId ?? "-", sortingComparator: byText((row) => row.VpcId) },
      { id: "az", header: "Availability Zone", cell: (row) => row.AvailabilityZone ?? "-", sortingComparator: byText((row) => row.AvailabilityZone) },
      { id: "privateIp", header: "Primary private IPv4", cell: (row) => row.PrivateIpAddress ?? "-" },
      { id: "status", header: "Interface status", cell: (row) => row.Status ?? "-", sortingComparator: byText((row) => row.Status) },
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
      { id: "name", header: "AMI name", cell: (row) => row.Name ?? "-", isRowHeader: true, sortingComparator: byText((row) => row.Name) },
      { id: "id", header: "AMI ID", cell: (row) => row.ImageId ?? "-", sortingComparator: byText((row) => row.ImageId) },
      { id: "state", header: "Status", cell: (row) => row.State ?? "-", sortingComparator: byText((row) => row.State) },
      { id: "arch", header: "Architecture", cell: (row) => row.Architecture ?? "-", sortingComparator: byText((row) => row.Architecture) },
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
      { id: "name", header: "Name", cell: (row) => row.LoadBalancerName ?? "-", isRowHeader: true, sortingComparator: byText((row) => row.LoadBalancerName) },
      { id: "dns", header: "DNS name", cell: (row) => row.DNSName ?? "-" },
      { id: "state", header: "State", cell: (row) => row.State?.Code ?? "-", sortingComparator: byText((row) => row.State?.Code) },
      { id: "type", header: "Type", cell: (row) => row.Type ?? "-", sortingComparator: byText((row) => row.Type) },
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
      { id: "name", header: "Name", cell: (row) => row.TargetGroupName ?? "-", isRowHeader: true, sortingComparator: byText((row) => row.TargetGroupName) },
      { id: "port", header: "Port", cell: (row) => row.Port ?? "-", sortingComparator: byNumber((row) => row.Port) },
      { id: "protocol", header: "Protocol", cell: (row) => row.Protocol ?? "-", sortingComparator: byText((row) => row.Protocol) },
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
        sortingComparator: byNumber((row) => row.Port),
      },
      { id: "lb", header: "Load balancer", cell: (row) => row.loadBalancerName ?? "-", sortingComparator: byText((row) => row.loadBalancerName) },
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
        sortingComparator: byText((row) => row.AutoScalingGroupName),
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
        sortingComparator: byNumber((row) => (row.Instances ?? []).length),
      },
      { id: "desired", header: "Desired capacity", cell: (row) => row.DesiredCapacity ?? "-", sortingComparator: byNumber((row) => row.DesiredCapacity) },
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
        sortingComparator: byText((row) => row.LaunchConfigurationName),
      },
      { id: "ami", header: "AMI ID", cell: (row) => row.ImageId ?? "-" },
      { id: "type", header: "Instance type", cell: (row) => row.InstanceType ?? "-", sortingComparator: byText((row) => row.InstanceType) },
      { id: "key", header: "Key name", cell: (row) => row.KeyName ?? "—" },
      {
        id: "created",
        header: "Creation time",
        cell: (row) => (row.CreatedTime ? new Date(row.CreatedTime).toLocaleString() : "—"),
        sortingComparator: byNumber((row) => (row.CreatedTime ? new Date(row.CreatedTime).getTime() : 0)),
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
    create: { label: "Create VPC", Modal: CreateVpcModal },
    actions: [
      deleteAction({
        label: "Delete VPC",
        header: "Delete VPC?",
        consequence:
          "A VPC cannot be deleted while it still contains subnets, gateways, or instances. Delete those first.",
        confirmPhrase: "delete",
        describe: (row) => `${row.VpcId} (${row.CidrBlock})`,
        run: async ({ ec2 }, row) =>
          void (await ec2.send(new DeleteVpcCommand({ VpcId: row.VpcId }))),
      }),
    ],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true, sortingComparator: byText((row) => nameTag(row.Tags)) },
      { id: "id", header: "VPC ID", cell: (row) => row.VpcId ?? "-", sortingComparator: byText((row) => row.VpcId) },
      { id: "state", header: "State", cell: (row) => row.State ?? "-", sortingComparator: byText((row) => row.State) },
      { id: "cidr", header: "IPv4 CIDR", cell: (row) => row.CidrBlock ?? "-", sortingComparator: byText((row) => row.CidrBlock) },
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
    create: { label: "Create subnet", Modal: CreateSubnetModal },
    actions: [
      deleteAction({
        label: "Delete subnet",
        header: "Delete subnet?",
        consequence:
          "A subnet cannot be deleted while instances or network interfaces are still in it.",
        confirmPhrase: "delete",
        describe: (row) => `${row.SubnetId} (${row.CidrBlock})`,
        run: async ({ ec2 }, row) =>
          void (await ec2.send(new DeleteSubnetCommand({ SubnetId: row.SubnetId }))),
      }),
    ],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true, sortingComparator: byText((row) => nameTag(row.Tags)) },
      { id: "id", header: "Subnet ID", cell: (row) => row.SubnetId ?? "-", sortingComparator: byText((row) => row.SubnetId) },
      { id: "state", header: "State", cell: (row) => row.State ?? "-", sortingComparator: byText((row) => row.State) },
      { id: "vpc", header: "VPC", cell: (row) => row.VpcId ?? "-", sortingComparator: byText((row) => row.VpcId) },
      { id: "cidr", header: "IPv4 CIDR", cell: (row) => row.CidrBlock ?? "-", sortingComparator: byText((row) => row.CidrBlock) },
      {
        id: "available",
        header: "Available IPv4 addresses",
        cell: (row) => row.AvailableIpAddressCount ?? "-",
        sortingComparator: byNumber((row) => row.AvailableIpAddressCount),
      },
      { id: "az", header: "Availability Zone", cell: (row) => row.AvailabilityZone ?? "-", sortingComparator: byText((row) => row.AvailabilityZone) },
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
    create: { label: "Create route table", Modal: CreateRouteTableModal },
    actions: [
      deleteAction({
        label: "Delete route table",
        header: "Delete route table?",
        consequence:
          "A route table cannot be deleted while it is the main table for a VPC or still has subnet associations.",
        confirmPhrase: "delete",
        describe: (row) => `${row.RouteTableId} (${row.VpcId})`,
        run: async ({ ec2 }, row) =>
          void (await ec2.send(new DeleteRouteTableCommand({ RouteTableId: row.RouteTableId }))),
      }),
    ],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true, sortingComparator: byText((row) => nameTag(row.Tags)) },
      { id: "id", header: "Route table ID", cell: (row) => row.RouteTableId ?? "-", sortingComparator: byText((row) => row.RouteTableId) },
      { id: "vpc", header: "VPC", cell: (row) => row.VpcId ?? "-", sortingComparator: byText((row) => row.VpcId) },
      {
        id: "routes",
        header: "Routes",
        cell: (row) => String((row.Routes ?? []).length),
        sortingComparator: byNumber((row) => (row.Routes ?? []).length),
      },
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
    create: { label: "Create internet gateway", Modal: CreateInternetGatewayModal },
    actions: [
      deleteAction({
        label: "Delete internet gateway",
        header: "Delete internet gateway?",
        consequence: "An internet gateway must be detached from its VPC before it can be deleted.",
        confirmPhrase: "delete",
        describe: (row) => row.InternetGatewayId,
        run: async ({ ec2 }, row) =>
          void (await ec2.send(
            new DeleteInternetGatewayCommand({ InternetGatewayId: row.InternetGatewayId }),
          )),
      }),
    ],
    columns: [
      { id: "name", header: "Name", cell: (row) => nameTag(row.Tags), isRowHeader: true, sortingComparator: byText((row) => nameTag(row.Tags)) },
      { id: "id", header: "Internet gateway ID", cell: (row) => row.InternetGatewayId ?? "-", sortingComparator: byText((row) => row.InternetGatewayId) },
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
      { id: "type", header: "Instance type", cell: (row) => row.InstanceType ?? "-", isRowHeader: true, sortingComparator: byText((row) => row.InstanceType) },
      { id: "vcpu", header: "vCPUs", cell: (row) => row.VCpuInfo?.DefaultVCpus ?? "-", sortingComparator: byNumber((row) => row.VCpuInfo?.DefaultVCpus) },
      {
        id: "memory",
        header: "Memory (GiB)",
        cell: (row) => (row.MemoryInfo?.SizeInMiB ? row.MemoryInfo.SizeInMiB / 1024 : "-"),
        sortingComparator: byNumber((row) => row.MemoryInfo?.SizeInMiB),
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

/** AWS's wording for a permission count: "3 Permission entries", or "—" when there are none. */
function permissionEntries(permissions: Row[] | undefined): string {
  const count = countEntries(permissions);
  return count === 0 ? "—" : `${count} Permission ${count === 1 ? "entry" : "entries"}`;
}

function countEntries(permissions: Row[] | undefined): number {
  return (permissions ?? []).reduce(
    (total: number, permission: Row) =>
      total +
      Math.max(
        1,
        (permission.IpRanges ?? []).length +
          (permission.Ipv6Ranges ?? []).length +
          (permission.UserIdGroupPairs ?? []).length,
      ),
    0,
  );
}

/** Sorts missing values last in ascending order rather than first, as AWS does. */
function byText(pick: (row: Row) => string | undefined) {
  return (a: Row, b: Row) => (pick(a) ?? "￿").localeCompare(pick(b) ?? "￿");
}

function byNumber(pick: (row: Row) => number | undefined) {
  return (a: Row, b: Row) => (pick(a) ?? Number.MAX_SAFE_INTEGER) - (pick(b) ?? Number.MAX_SAFE_INTEGER);
}

export default function ResourceListPage() {
  const { resource = "" } = useParams();
  const definition = RESOURCES[resource];
  const ec2 = useEc2Client();
  const elb = useAwsClient(ElasticLoadBalancingV2Client);
  const autoscaling = useAwsClient(AutoScalingClient);
  const { region, accessKeyId } = useEmulator();
  const { notify } = useNotifications();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
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

  const clients = useMemo<Ec2PageClients>(() => ({ ec2, elb, autoscaling }), [ec2, elb, autoscaling]);

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
      setRows(await definition.load(clients));
      setFailed(false);
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
  }, [resource, region, accessKeyId]);

  if (!definition) {
    return <NotFoundPage />;
  }

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
              <SpaceBetween direction="horizontal" size="xs">
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
