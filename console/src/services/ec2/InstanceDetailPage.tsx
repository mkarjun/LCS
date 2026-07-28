import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  RebootInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
} from "@aws-sdk/client-ec2";
import type { Instance, Volume } from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";

import { describeAwsError } from "@platform/awsClient";
import { useEmulator } from "@platform/EmulatorContext";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { instanceStateIndicator } from "./instanceState";
import { nameTag, useEc2Client } from "./useEc2Client";

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

export default function InstanceDetailPage() {
  const { instanceId = "" } = useParams();
  const navigate = useNavigate();
  const client = useEc2Client();
  const { notify } = useNotifications();
  const { region, effectiveAccountId } = useEmulator();
  const [searchParams, setSearchParams] = useSearchParams();

  const [instance, setInstance] = useState<Instance | null>(null);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const activeTab = searchParams.get("tab") ?? "details";

  useBreadcrumbs([
    { text: "EC2", href: "/ec2" },
    { text: "Instances", href: "/ec2/instances" },
    { text: instanceId, href: `/ec2/instances/${instanceId}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(
        new DescribeInstancesCommand({ InstanceIds: [instanceId] }),
      );
      const found = (response.Reservations ?? []).flatMap((r) => r.Instances ?? [])[0] ?? null;
      setInstance(found);
      setUpdatedAt(new Date());

      const volumeIds = (found?.BlockDeviceMappings ?? [])
        .map((mapping) => mapping.Ebs?.VolumeId)
        .filter((id): id is string => !!id);
      if (volumeIds.length > 0) {
        const volumeResponse = await client.send(
          new DescribeVolumesCommand({ VolumeIds: volumeIds }),
        );
        setVolumes(volumeResponse.Volumes ?? []);
      } else {
        setVolumes([]);
      }
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load instance — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, instanceId, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const runStateAction = async (actionId: string) => {
    try {
      const ids = [instanceId];
      switch (actionId) {
        case "start":
          await client.send(new StartInstancesCommand({ InstanceIds: ids }));
          break;
        case "stop":
          await client.send(new StopInstancesCommand({ InstanceIds: ids }));
          break;
        case "reboot":
          await client.send(new RebootInstancesCommand({ InstanceIds: ids }));
          break;
        case "terminate":
          await client.send(new TerminateInstancesCommand({ InstanceIds: ids }));
          break;
        default:
          return;
      }
      notify({ type: "success", content: `Successfully initiated ${actionId}.` });
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't ${actionId} instance — ${title}`, content: detail });
    }
  };

  if (loading && instance === null) {
    return (
      <Box textAlign="center" padding={{ vertical: "xxl" }}>
        <Spinner size="large" />
      </Box>
    );
  }

  if (instance === null) {
    return (
      <ContentLayout header={<Header variant="h1">{instanceId}</Header>}>
        <Container>
          <Box textAlign="center" padding={{ vertical: "l" }}>
            <SpaceBetween size="s">
              <Box variant="strong">Instance not found</Box>
              <Button onClick={() => navigate("/ec2/instances")}>Back to instances</Button>
            </SpaceBetween>
          </Box>
        </Container>
      </ContentLayout>
    );
  }

  const name = nameTag(instance.Tags);
  const nameSuffix = name === "—" ? "" : ` (${name})`;
  const arn = `arn:aws:ec2:${region}:${effectiveAccountId}:instance/${instance.InstanceId}`;
  const securityGroups = instance.SecurityGroups ?? [];
  const interfaces = instance.NetworkInterfaces ?? [];
  const running = instance.State?.Name === "running";

  const summary = (
    <Container>
      <ColumnLayout columns={3} variant="text-grid">
        {field("Instance ID", value(instance.InstanceId))}
        {field("Public IPv4 address", value(instance.PublicIpAddress))}
        {field("Private IPv4 addresses", value(instance.PrivateIpAddress))}
        {field("IPv6 address", value(instance.Ipv6Address))}
        {field("Instance state", instanceStateIndicator(instance.State?.Name))}
        {field("Public IPv4 DNS", value(instance.PublicDnsName))}
        {field("Hostname type", value(instance.PrivateDnsName))}
        {field("Private IP DNS name (IPv4 only)", value(instance.PrivateDnsName))}
        {field("Instance type", value(instance.InstanceType))}
        {field("VPC ID", value(instance.VpcId))}
        {field("Subnet ID", value(instance.SubnetId))}
        {field("IAM role", value(instance.IamInstanceProfile?.Arn))}
        {field("Auto Scaling Group name", "—")}
        {field("Instance ARN", arn)}
        {field("Key pair assigned at launch", value(instance.KeyName))}
      </ColumnLayout>
    </Container>
  );

  const detailsTab = (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Instance details</Header>}>
        <ColumnLayout columns={3} variant="text-grid">
          {field("AMI ID", value(instance.ImageId))}
          {field("Monitoring", value(instance.Monitoring?.State))}
          {field("Platform details", "Linux/UNIX")}
          {field("AMI name", "—")}
          {field("Launch time", value(instance.LaunchTime?.toLocaleString()))}
          {field("Termination protection", "Disabled")}
          {field("Architecture", value(instance.Architecture))}
          {field("Virtualization type", value(instance.VirtualizationType))}
          {field("Hypervisor", value(instance.Hypervisor))}
          {field("Root device name", value(instance.RootDeviceName))}
          {field("Root device type", value(instance.RootDeviceType))}
          {field("EBS optimized", value(instance.EbsOptimized))}
          {field("State transition reason", value(instance.StateTransitionReason))}
          {field("Owner", effectiveAccountId)}
          {field("Reservation", "—")}
        </ColumnLayout>
      </Container>
      <Container header={<Header variant="h2">Host and placement group</Header>}>
        <ColumnLayout columns={3} variant="text-grid">
          {field("Availability Zone", value(instance.Placement?.AvailabilityZone))}
          {field("Tenancy", value(instance.Placement?.Tenancy))}
          {field("Placement group", value(instance.Placement?.GroupName))}
        </ColumnLayout>
      </Container>
    </SpaceBetween>
  );

  const statusTab = (
    <Container header={<Header variant="h2">Status checks</Header>}>
      <ColumnLayout columns={3} variant="text-grid">
        {field("Instance state", instanceStateIndicator(instance.State?.Name))}
        {field(
          "System status checks",
          running ? <StatusIndicator type="success">1/1 checks passed</StatusIndicator> : "—",
        )}
        {field(
          "Instance status checks",
          running ? <StatusIndicator type="success">2/2 checks passed</StatusIndicator> : "—",
        )}
      </ColumnLayout>
    </Container>
  );

  const monitoringTab = (
    <Container header={<Header variant="h2">Monitoring</Header>}>
      <ColumnLayout columns={3} variant="text-grid">
        {field("Monitoring", value(instance.Monitoring?.State))}
        {field("EBS optimized", value(instance.EbsOptimized))}
        {field("Source/destination check", value(instance.SourceDestCheck))}
      </ColumnLayout>
    </Container>
  );

  const securityTab = (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Security details</Header>}>
        <ColumnLayout columns={3} variant="text-grid">
          {field("IAM role", value(instance.IamInstanceProfile?.Arn))}
          {field("Owner ID", effectiveAccountId)}
          {field("Key pair name", value(instance.KeyName))}
        </ColumnLayout>
      </Container>
      <Table
        variant="container"
        header={<Header variant="h2">Security groups</Header>}
        items={securityGroups}
        trackBy={(group) => group.GroupId ?? ""}
        columnDefinitions={[
          { id: "id", header: "Group ID", cell: (group) => group.GroupId ?? "-", isRowHeader: true },
          { id: "name", header: "Group name", cell: (group) => group.GroupName ?? "-" },
        ]}
        empty={
          <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
            No security groups attached.
          </Box>
        }
      />
    </SpaceBetween>
  );

  const networkingTab = (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Networking details</Header>}>
        <ColumnLayout columns={3} variant="text-grid">
          {field("Public IPv4 address", value(instance.PublicIpAddress))}
          {field("Private IPv4 addresses", value(instance.PrivateIpAddress))}
          {field("Availability Zone", value(instance.Placement?.AvailabilityZone))}
          {field("Public IPv4 DNS", value(instance.PublicDnsName))}
          {field("Private IP DNS name", value(instance.PrivateDnsName))}
          {field("VPC ID", value(instance.VpcId))}
          {field("Subnet ID", value(instance.SubnetId))}
          {field("Source/destination check", value(instance.SourceDestCheck))}
          {field("IPv6 address", value(instance.Ipv6Address))}
        </ColumnLayout>
      </Container>
      <Table
        variant="container"
        header={<Header variant="h2">Network interfaces</Header>}
        items={interfaces}
        trackBy={(item) => item.NetworkInterfaceId ?? ""}
        columnDefinitions={[
          {
            id: "id",
            header: "Interface ID",
            cell: (item) => item.NetworkInterfaceId ?? "-",
            isRowHeader: true,
          },
          { id: "privateIp", header: "Private IPv4 address", cell: (item) => item.PrivateIpAddress ?? "-" },
          { id: "subnet", header: "Subnet ID", cell: (item) => item.SubnetId ?? "-" },
          { id: "vpc", header: "VPC ID", cell: (item) => item.VpcId ?? "-" },
          { id: "status", header: "Status", cell: (item) => item.Status ?? "-" },
        ]}
        empty={
          <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
            No network interfaces.
          </Box>
        }
      />
    </SpaceBetween>
  );

  const storageTab = (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Root device details</Header>}>
        <ColumnLayout columns={3} variant="text-grid">
          {field("Root device name", value(instance.RootDeviceName))}
          {field("Root device type", value(instance.RootDeviceType))}
          {field("EBS optimized", value(instance.EbsOptimized))}
        </ColumnLayout>
      </Container>
      <Table
        variant="container"
        header={<Header variant="h2">Block devices</Header>}
        items={volumes}
        trackBy={(volume) => volume.VolumeId ?? ""}
        columnDefinitions={[
          { id: "id", header: "Volume ID", cell: (v) => v.VolumeId ?? "-", isRowHeader: true },
          {
            id: "device",
            header: "Device name",
            cell: (v) => v.Attachments?.[0]?.Device ?? "-",
          },
          { id: "size", header: "Size", cell: (v) => (v.Size ? `${v.Size} GiB` : "-") },
          { id: "type", header: "Volume type", cell: (v) => v.VolumeType ?? "-" },
          { id: "status", header: "Attachment status", cell: (v) => v.Attachments?.[0]?.State ?? "-" },
          {
            id: "encrypted",
            header: "Encrypted",
            cell: (v) => (v.Encrypted ? "Yes" : "No"),
          },
        ]}
        empty={
          <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
            No block devices attached.
          </Box>
        }
      />
    </SpaceBetween>
  );

  const tagsTab = (
    <Table
      variant="container"
      header={<Header variant="h2">Tags ({(instance.Tags ?? []).length})</Header>}
      items={instance.Tags ?? []}
      trackBy={(tag) => tag.Key ?? ""}
      columnDefinitions={[
        { id: "key", header: "Key", cell: (tag) => tag.Key ?? "-", isRowHeader: true },
        { id: "value", header: "Value", cell: (tag) => tag.Value ?? "-" },
      ]}
      empty={
        <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
          No tags associated with this instance.
        </Box>
      }
    />
  );

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={
            updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : undefined
          }
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
              <ButtonDropdown
                items={[
                  { id: "start", text: "Start instance" },
                  { id: "stop", text: "Stop instance" },
                  { id: "reboot", text: "Reboot instance" },
                  { id: "terminate", text: "Terminate (delete) instance" },
                ]}
                onItemClick={(event) => void runStateAction(event.detail.id)}
              >
                Instance state
              </ButtonDropdown>
            </SpaceBetween>
          }
        >
          {`Instance summary for ${instanceId}${nameSuffix}`}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {summary}
        <Tabs
          activeTabId={activeTab}
          onChange={(event) => setSearchParams({ tab: event.detail.activeTabId })}
          tabs={[
            { id: "details", label: "Details", content: detailsTab },
            { id: "status", label: "Status and alarms", content: statusTab },
            { id: "monitoring", label: "Monitoring", content: monitoringTab },
            { id: "security", label: "Security", content: securityTab },
            { id: "networking", label: "Networking", content: networkingTab },
            { id: "storage", label: "Storage", content: storageTab },
            { id: "tags", label: "Tags", content: tagsTab },
          ]}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}
