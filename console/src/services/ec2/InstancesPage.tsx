import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  RebootInstancesCommand,
  TerminateInstancesCommand,
} from "@aws-sdk/client-ec2";
import type { Instance } from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { LaunchInstanceModal } from "./LaunchInstanceModal";
import { instanceStateIndicator } from "./instanceState";
import { nameTag, useEc2Client } from "./useEc2Client";

const PAGE_SIZE = 20;

export default function InstancesPage() {
  const navigate = useNavigate();
  const client = useEc2Client();
  const { notify } = useNotifications();

  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState<Instance[]>([]);
  const [launchOpen, setLaunchOpen] = useState(false);

  useBreadcrumbs([
    { text: "EC2", href: "/ec2" },
    { text: "Instances", href: "/ec2/instances" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(new DescribeInstancesCommand({}));
      setInstances((response.Reservations ?? []).flatMap((r) => r.Instances ?? []));
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load instances — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const runStateAction = async (actionId: string) => {
    const ids = selected.map((i) => i.InstanceId).filter((id): id is string => !!id);
    if (ids.length === 0) {
      return;
    }
    try {
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
      notify({ type: "success", content: `Successfully initiated ${actionId} on ${ids.length} instance${ids.length === 1 ? "" : "s"}.` });
      setSelected([]);
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't ${actionId} instance — ${title}`, content: detail });
    }
  };

  // AWS filters instances case-sensitively by attribute or tag.
  const query = filterText.trim();
  const matching = instances.filter((instance) =>
    query === ""
      ? true
      : [
          instance.InstanceId,
          instance.InstanceType,
          instance.PrivateIpAddress,
          instance.PublicIpAddress,
          instance.State?.Name,
          ...(instance.Tags ?? []).map((tag) => `${tag.Key}=${tag.Value}`),
        ]
          .filter(Boolean)
          .some((value) => String(value).includes(query)),
  );
  const pageItems = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const anySelected = selected.length > 0;

  return (
    <ContentLayout header={<Header variant="h1">Instances</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading instances"
        items={pageItems}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
        trackBy={(instance) => instance.InstanceId ?? ""}
        header={
          <Header
            counter={loading ? undefined : `(${instances.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                <ButtonDropdown
                  disabled={!anySelected}
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
                <Button variant="primary" onClick={() => setLaunchOpen(true)}>
                  Launch instances
                </Button>
              </SpaceBetween>
            }
          >
            Instances
          </Header>
        }
        columnDefinitions={[
          { id: "name", header: "Name", cell: (instance) => nameTag(instance.Tags), isRowHeader: true },
          {
            id: "instanceId",
            header: "Instance ID",
            cell: (instance) => (
              <Link
                href={`/ec2/instances/${instance.InstanceId}`}
                onFollow={(event) => {
                  event.preventDefault();
                  navigate(`/ec2/instances/${instance.InstanceId}`);
                }}
              >
                {instance.InstanceId}
              </Link>
            ),
          },
          {
            id: "state",
            header: "Instance state",
            cell: (instance) => instanceStateIndicator(instance.State?.Name),
          },
          { id: "type", header: "Instance type", cell: (instance) => instance.InstanceType ?? "-" },
          {
            id: "statusCheck",
            header: "Status check",
            cell: (instance) =>
              instance.State?.Name === "running" ? (
                <StatusIndicator type="success">3/3 checks passed</StatusIndicator>
              ) : (
                "-"
              ),
          },
          {
            id: "az",
            header: "Availability Zone",
            cell: (instance) => instance.Placement?.AvailabilityZone ?? "-",
          },
          {
            id: "publicDns",
            header: "Public IPv4 DNS",
            cell: (instance) => instance.PublicDnsName || "—",
          },
          {
            id: "publicIp",
            header: "Public IPv4 address",
            cell: (instance) => instance.PublicIpAddress || "—",
          },
          {
            id: "privateIp",
            header: "Private IPv4 address",
            cell: (instance) => instance.PrivateIpAddress || "—",
          },
        ]}
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder="Find Instance by attribute or tag (case-sensitive)"
            filteringAriaLabel="Find instance"
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
                <Box variant="strong">Couldn't load instances</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No instances</Box>
                <Box variant="p" color="text-body-secondary">
                  You do not have any instances in this Region.
                </Box>
                <Button onClick={() => setLaunchOpen(true)}>Launch instances</Button>
              </SpaceBetween>
            </Box>
          )
        }
      />

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
