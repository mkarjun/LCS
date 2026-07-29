import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  GetTemplateCommand,
  ListChangeSetsCommand,
  ListStackResourcesCommand,
} from "@aws-sdk/client-cloudformation";
import type {
  ChangeSetSummary,
  Stack,
  StackEvent,
  StackResourceSummary,
} from "@aws-sdk/client-cloudformation";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";
import type { ReactNode } from "react";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { CreateStackModal } from "./CreateStackModal";
import { cfnStatusIndicator, formatTimestamp } from "./cfnFormat";

/**
 * Stack detail.
 *
 * AWS's tabs are Stack info, Events, Resources, Outputs, Parameters, Template, Change
 * sets, and Git sync. Git sync is omitted (no backend). The change set list is real but
 * carries no per-change diff: LCS records change sets without computing a resource-level
 * preview, so the tab lists them without a Changes table.
 */
export default function StackDetailPage() {
  const { stackName = "" } = useParams();
  const navigate = useNavigate();
  const client = useAwsClient(CloudFormationClient);
  const { notify } = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();

  const [stack, setStack] = useState<Stack | null>(null);
  const [resources, setResources] = useState<StackResourceSummary[]>([]);
  const [events, setEvents] = useState<StackEvent[]>([]);
  const [changeSets, setChangeSets] = useState<ChangeSetSummary[]>([]);
  const [template, setTemplate] = useState("");
  const [loading, setLoading] = useState(true);
  const [updateOpen, setUpdateOpen] = useState(false);

  const activeTab = searchParams.get("tab") ?? "info";

  useBreadcrumbs([
    { text: "CloudFormation", href: "/cloudformation" },
    { text: "Stacks", href: "/cloudformation" },
    { text: stackName, href: `/cloudformation/stacks/${stackName}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(new DescribeStacksCommand({ StackName: stackName }));
      setStack(response.Stacks?.[0] ?? null);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load stack — ${title}`, content: detail });
      setLoading(false);
      return;
    }

    // The four supporting reads are independent of each other; a failure in one should not
    // blank the tabs the others fill.
    const [resourceResult, eventResult, changeSetResult, templateResult] =
      await Promise.allSettled([
        client.send(new ListStackResourcesCommand({ StackName: stackName })),
        client.send(new DescribeStackEventsCommand({ StackName: stackName })),
        client.send(new ListChangeSetsCommand({ StackName: stackName })),
        client.send(new GetTemplateCommand({ StackName: stackName })),
      ]);

    setResources(
      resourceResult.status === "fulfilled"
        ? (resourceResult.value.StackResourceSummaries ?? [])
        : [],
    );
    setEvents(eventResult.status === "fulfilled" ? (eventResult.value.StackEvents ?? []) : []);
    setChangeSets(
      changeSetResult.status === "fulfilled" ? (changeSetResult.value.Summaries ?? []) : [],
    );
    setTemplate(
      templateResult.status === "fulfilled" ? (templateResult.value.TemplateBody ?? "") : "",
    );
    setLoading(false);
  }, [client, stackName, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    try {
      await client.send(new DeleteStackCommand({ StackName: stackName }));
      notify({ type: "success", content: `Deleted stack "${stackName}".` });
      navigate("/cloudformation");
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't delete stack — ${title}`, content: detail });
    }
  };

  if (loading) {
    return (
      <Box textAlign="center" padding={{ vertical: "xxl" }}>
        <Spinner size="large" />
      </Box>
    );
  }

  // A deleted or mistyped stack name would otherwise render every tab empty, which reads
  // as a broken stack rather than a missing one.
  if (stack === null) {
    return (
      <ContentLayout header={<Header variant="h1">{stackName}</Header>}>
        <Container>
          <Box textAlign="center" padding={{ vertical: "xl" }}>
            <SpaceBetween size="s">
              <Box variant="strong">Stack not found</Box>
              <Box variant="p" color="text-body-secondary">
                No stack named "{stackName}" exists in this Region.
              </Box>
              <Button onClick={() => navigate("/cloudformation")}>Back to Stacks</Button>
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

  const emptyPanel = (text: string) => (
    <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
      {text}
    </Box>
  );

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
              <Button onClick={() => setUpdateOpen(true)}>Update</Button>
              <Button onClick={() => void remove()}>Delete</Button>
            </SpaceBetween>
          }
        >
          {stackName}
        </Header>
      }
    >
      <Tabs
        activeTabId={activeTab}
        onChange={(event) => setSearchParams({ tab: event.detail.activeTabId })}
        tabs={[
          {
            id: "info",
            label: "Stack info",
            content: (
              <SpaceBetween size="l">
                <Container header={<Header variant="h2">Overview</Header>}>
                  <ColumnLayout columns={3} variant="text-grid">
                    {field("Stack ID", stack?.StackId ?? "—")}
                    {field("Stack name", stack?.StackName ?? "—")}
                    {field("Status", cfnStatusIndicator(stack?.StackStatus))}
                    {field("Status reason", stack?.StackStatusReason ?? "—")}
                    {field("Created time", formatTimestamp(stack?.CreationTime))}
                    {field("Last updated time", formatTimestamp(stack?.LastUpdatedTime))}
                    {field(
                      "Termination protection",
                      stack?.EnableTerminationProtection ? "Activated" : "Deactivated",
                    )}
                    {field(
                      "Capabilities",
                      (stack?.Capabilities ?? []).length === 0
                        ? "—"
                        : (stack?.Capabilities ?? []).join(", "),
                    )}
                  </ColumnLayout>
                </Container>

                <Table
                  variant="container"
                  header={
                    <Header variant="h2" counter={`(${(stack?.Tags ?? []).length})`}>
                      Tags
                    </Header>
                  }
                  items={stack?.Tags ?? []}
                  trackBy={(tag) => tag.Key ?? ""}
                  columnDefinitions={[
                    { id: "key", header: "Key", isRowHeader: true, cell: (tag) => tag.Key ?? "" },
                    { id: "value", header: "Value", cell: (tag) => tag.Value ?? "" },
                  ]}
                  empty={emptyPanel("No tags on this stack.")}
                />
              </SpaceBetween>
            ),
          },
          {
            id: "events",
            label: "Events",
            content: (
              <Table
                variant="container"
                header={
                  <Header variant="h2" counter={`(${events.length})`}>
                    Events
                  </Header>
                }
                items={events}
                trackBy={(event) => event.EventId ?? ""}
                columnDefinitions={[
                  {
                    id: "timestamp",
                    header: "Timestamp",
                    isRowHeader: true,
                    cell: (event) => formatTimestamp(event.Timestamp),
                  },
                  {
                    id: "logicalId",
                    header: "Logical ID",
                    cell: (event) => event.LogicalResourceId ?? "—",
                  },
                  {
                    id: "status",
                    header: "Status",
                    cell: (event) => cfnStatusIndicator(event.ResourceStatus),
                  },
                  {
                    id: "type",
                    header: "Type",
                    cell: (event) => event.ResourceType ?? "—",
                  },
                  {
                    id: "reason",
                    header: "Status reason",
                    cell: (event) => event.ResourceStatusReason ?? "—",
                  },
                ]}
                empty={emptyPanel("No events for this stack.")}
              />
            ),
          },
          {
            id: "resources",
            label: "Resources",
            content: (
              <Table
                variant="container"
                header={
                  <Header variant="h2" counter={`(${resources.length})`}>
                    Resources
                  </Header>
                }
                items={resources}
                trackBy={(resource) => resource.LogicalResourceId ?? ""}
                columnDefinitions={[
                  {
                    id: "logicalId",
                    header: "Logical ID",
                    isRowHeader: true,
                    cell: (resource) => resource.LogicalResourceId ?? "—",
                  },
                  {
                    id: "physicalId",
                    header: "Physical ID",
                    cell: (resource) => resource.PhysicalResourceId ?? "—",
                  },
                  { id: "type", header: "Type", cell: (resource) => resource.ResourceType ?? "—" },
                  {
                    id: "status",
                    header: "Status",
                    cell: (resource) => cfnStatusIndicator(resource.ResourceStatus),
                  },
                  {
                    id: "updated",
                    header: "Last updated",
                    cell: (resource) => formatTimestamp(resource.LastUpdatedTimestamp),
                  },
                ]}
                empty={emptyPanel("This stack has no resources.")}
              />
            ),
          },
          {
            id: "outputs",
            label: "Outputs",
            content: (
              <Table
                variant="container"
                header={
                  <Header variant="h2" counter={`(${(stack?.Outputs ?? []).length})`}>
                    Outputs
                  </Header>
                }
                items={stack?.Outputs ?? []}
                trackBy={(output) => output.OutputKey ?? ""}
                columnDefinitions={[
                  {
                    id: "key",
                    header: "Key",
                    isRowHeader: true,
                    cell: (output) => output.OutputKey ?? "—",
                  },
                  { id: "value", header: "Value", cell: (output) => output.OutputValue ?? "—" },
                  {
                    id: "description",
                    header: "Description",
                    cell: (output) => output.Description ?? "—",
                  },
                  {
                    id: "export",
                    header: "Export name",
                    cell: (output) => output.ExportName ?? "—",
                  },
                ]}
                empty={emptyPanel("This stack declares no outputs.")}
              />
            ),
          },
          {
            id: "parameters",
            label: "Parameters",
            content: (
              <Table
                variant="container"
                header={
                  <Header variant="h2" counter={`(${(stack?.Parameters ?? []).length})`}>
                    Parameters
                  </Header>
                }
                items={stack?.Parameters ?? []}
                trackBy={(parameter) => parameter.ParameterKey ?? ""}
                columnDefinitions={[
                  {
                    id: "key",
                    header: "Key",
                    isRowHeader: true,
                    cell: (parameter) => parameter.ParameterKey ?? "—",
                  },
                  {
                    id: "value",
                    header: "Value",
                    cell: (parameter) => parameter.ParameterValue ?? "—",
                  },
                ]}
                empty={emptyPanel("This stack was created without parameters.")}
              />
            ),
          },
          {
            id: "template",
            label: "Template",
            content: (
              <Container header={<Header variant="h2">Template</Header>}>
                <Textarea value={template} rows={28} readOnly spellcheck={false} />
              </Container>
            ),
          },
          {
            id: "changesets",
            label: "Change sets",
            content: (
              <Table
                variant="container"
                header={
                  <Header
                    variant="h2"
                    counter={`(${changeSets.length})`}
                    description="LCS records change sets but does not compute a resource-level diff, so there is no per-change preview."
                  >
                    Change sets
                  </Header>
                }
                items={changeSets}
                trackBy={(changeSet) => changeSet.ChangeSetId ?? ""}
                columnDefinitions={[
                  {
                    id: "name",
                    header: "Name",
                    isRowHeader: true,
                    cell: (changeSet) => changeSet.ChangeSetName ?? "—",
                  },
                  {
                    id: "status",
                    header: "Status",
                    cell: (changeSet) => cfnStatusIndicator(changeSet.Status),
                  },
                  {
                    id: "execution",
                    header: "Execution status",
                    cell: (changeSet) => changeSet.ExecutionStatus ?? "—",
                  },
                  {
                    id: "created",
                    header: "Created",
                    cell: (changeSet) => formatTimestamp(changeSet.CreationTime),
                  },
                ]}
                empty={emptyPanel("No change sets for this stack.")}
              />
            ),
          },
        ]}
      />

      <CreateStackModal
        visible={updateOpen}
        updateStackName={stackName}
        onDismiss={() => setUpdateOpen(false)}
        onSubmitted={async () => {
          setUpdateOpen(false);
          await load();
        }}
      />
    </ContentLayout>
  );
}
