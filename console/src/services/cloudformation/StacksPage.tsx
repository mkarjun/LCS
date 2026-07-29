import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import type { Stack } from "@aws-sdk/client-cloudformation";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import Toggle from "@cloudscape-design/components/toggle";
import type { SelectProps } from "@cloudscape-design/components/select";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { CreateStackModal } from "./CreateStackModal";
import { cfnStatusIndicator, formatTimestamp, unavailableCell } from "./cfnFormat";

/**
 * AWS's Filter status dropdown. "Active" is its default and means "everything except
 * deleted"; DeleteStack here removes the stack outright, so Active and All see the same
 * set and the choice narrows to a status prefix.
 */
const STATUS_FILTERS: SelectProps.Option[] = [
  { label: "Active", value: "active" },
  { label: "All", value: "all" },
  { label: "Create complete", value: "CREATE_COMPLETE" },
  { label: "Failed", value: "FAILED" },
];

/**
 * Stacks — CloudFormation's landing page in the AWS console.
 *
 * The list comes from DescribeStacks rather than ListStacks: both return the same stacks
 * here, but DescribeStacks carries outputs and tags, so the detail page has them warm.
 * AWS's Description column is omitted because DescribeStacks does not return a stack
 * description.
 */
export default function StacksPage() {
  const navigate = useNavigate();
  const client = useAwsClient(CloudFormationClient);
  const { notify } = useNotifications();

  const [stacks, setStacks] = useState<Stack[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [selected, setSelected] = useState<Stack[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [updateTarget, setUpdateTarget] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<SelectProps.Option>(STATUS_FILTERS[0]);

  useBreadcrumbs([
    { text: "CloudFormation", href: "/cloudformation" },
    { text: "Stacks", href: "/cloudformation" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(new DescribeStacksCommand({}));
      setStacks(response.Stacks ?? []);
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load stacks — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const deleteSelected = async () => {
    try {
      await Promise.all(
        selected.map((stack) =>
          client.send(new DeleteStackCommand({ StackName: stack.StackName })),
        ),
      );
      notify({ type: "success", content: `Deleted ${selected.length} stack(s).` });
      setSelected([]);
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't delete stack — ${title}`, content: detail });
    }
  };

  const query = filterText.trim().toLowerCase();
  const status = statusFilter.value ?? "active";
  const matching = stacks.filter((stack) => {
    if (query !== "" && !(stack.StackName ?? "").toLowerCase().includes(query)) {
      return false;
    }
    if (status === "active" || status === "all") {
      return true;
    }
    // "Failed" groups every *_FAILED status the way AWS's filter does.
    return status === "FAILED"
      ? (stack.StackStatus ?? "").endsWith("_FAILED")
      : stack.StackStatus === status;
  });

  return (
    <ContentLayout header={<Header variant="h1">Stacks</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading stacks"
        items={matching}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
        trackBy={(stack) => stack.StackId ?? stack.StackName ?? ""}
        header={
          <Header
            counter={loading ? undefined : `(${stacks.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                <Button disabled={selected.length === 0} onClick={() => void deleteSelected()}>
                  Delete stack
                </Button>
                <Button
                  disabled={selected.length !== 1}
                  onClick={() => setUpdateTarget(selected[0]?.StackName)}
                >
                  Update stack
                </Button>
                <ButtonDropdown
                  disabled={selected.length !== 1}
                  items={[
                    {
                      id: "drift",
                      text: "Detect drift",
                      disabled: true,
                      disabledReason: "DetectStackDrift is not implemented.",
                    },
                    {
                      id: "import",
                      text: "Import resources into stack",
                      disabled: true,
                      disabledReason: "Resource import is not implemented.",
                    },
                    {
                      id: "policy",
                      text: "Edit stack policy",
                      disabled: true,
                      disabledReason: "SetStackPolicy is accepted but never enforced.",
                    },
                  ]}
                  // Every entry is disabled today; the menu exists so the AWS shape is
                  // visible and the reasons are readable.
                  onItemClick={() => undefined}
                >
                  Stack actions
                </ButtonDropdown>
                <ButtonDropdown
                  variant="primary"
                  items={[
                    { id: "new", text: "With new resources (standard)" },
                    {
                      id: "existing",
                      text: "With existing resources (import resources)",
                      disabled: true,
                      disabledReason: "Resource import is not implemented.",
                    },
                  ]}
                  onItemClick={(event) => {
                    if (event.detail.id === "new") {
                      setCreateOpen(true);
                    }
                  }}
                >
                  Create stack
                </ButtonDropdown>
              </SpaceBetween>
            }
          >
            Stacks
          </Header>
        }
        columnDefinitions={[
          {
            id: "name",
            header: "Stack name",
            isRowHeader: true,
            cell: (stack) => (
              <Link
                href={`/cloudformation/stacks/${stack.StackName}`}
                onFollow={(event) => {
                  event.preventDefault();
                  navigate(`/cloudformation/stacks/${stack.StackName}`);
                }}
              >
                {stack.StackName}
              </Link>
            ),
          },
          {
            id: "status",
            header: "Status",
            cell: (stack) => cfnStatusIndicator(stack.StackStatus),
          },
          {
            id: "created",
            header: "Created time",
            cell: (stack) => formatTimestamp(stack.CreationTime),
          },
          {
            id: "updated",
            header: "Updated time",
            cell: (stack) => formatTimestamp(stack.LastUpdatedTime),
          },
          {
            id: "description",
            header: "Description",
            cell: () => unavailableCell("DescribeStacks does not return a stack description"),
          },
        ]}
        filter={
          <SpaceBetween direction="horizontal" size="s" alignItems="center">
            <TextFilter
              filteringText={filterText}
              filteringPlaceholder="Search by stack name"
              filteringAriaLabel="Search stacks"
              countText={query ? `${matching.length} matches` : ""}
              onChange={(event) => setFilterText(event.detail.filteringText)}
            />
            <Select
              selectedOption={statusFilter}
              options={STATUS_FILTERS}
              ariaLabel="Filter status"
              onChange={(event) => setStatusFilter(event.detail.selectedOption)}
            />
            <Toggle
              checked
              disabled
              // DescribeStacks returns no ParentId here, so there is nothing to filter
              // nested stacks by; the toggle is shown to keep AWS's shape.
              onChange={() => undefined}
            >
              View nested
            </Toggle>
          </SpaceBetween>
        }
        empty={
          failed ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">Couldn't load stacks</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No stacks</Box>
                <Box variant="p" color="text-body-secondary">
                  Create a stack to provision resources from a template.
                </Box>
                <Button onClick={() => setCreateOpen(true)}>Create stack</Button>
              </SpaceBetween>
            </Box>
          )
        }
      />

      <CreateStackModal
        visible={createOpen}
        onDismiss={() => setCreateOpen(false)}
        onSubmitted={async (stackName) => {
          setCreateOpen(false);
          await load();
          navigate(`/cloudformation/stacks/${stackName}`);
        }}
      />

      <CreateStackModal
        visible={updateTarget !== undefined}
        updateStackName={updateTarget}
        onDismiss={() => setUpdateTarget(undefined)}
        onSubmitted={async (stackName) => {
          setUpdateTarget(undefined);
          setSelected([]);
          await load();
          navigate(`/cloudformation/stacks/${stackName}`);
        }}
      />
    </ContentLayout>
  );
}
