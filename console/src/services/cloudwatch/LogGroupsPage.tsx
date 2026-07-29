import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  DeleteLogGroupCommand,
  DescribeLogGroupsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import type { LogGroup } from "@aws-sdk/client-cloudwatch-logs";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Link from "@cloudscape-design/components/link";
import Modal from "@cloudscape-design/components/modal";
import FormField from "@cloudscape-design/components/form-field";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { dash, encodeLogName, formatBytes, formatRetention } from "./cloudwatchFormat";

const PAGE_SIZE = 20;

export default function LogGroupsPage() {
  const navigate = useNavigate();
  const client = useAwsClient(CloudWatchLogsClient);
  const { notify } = useNotifications();

  const [groups, setGroups] = useState<LogGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  // AWS offers an exact-match toggle beside the log group filter.
  const [exactMatch, setExactMatch] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState<LogGroup[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useBreadcrumbs([
    { text: "CloudWatch", href: "/cloudwatch" },
    { text: "Log groups", href: "/cloudwatch" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGroups((await client.send(new DescribeLogGroupsCommand({ limit: 50 }))).logGroups ?? []);
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load log groups — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const createGroup = async () => {
    setCreating(true);
    try {
      await client.send(new CreateLogGroupCommand({ logGroupName: newName.trim() }));
      notify({ type: "success", content: `Log group "${newName.trim()}" created.` });
      setCreateOpen(false);
      setNewName("");
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't create log group — ${title}`, content: detail });
    } finally {
      setCreating(false);
    }
  };

  const deleteSelected = async () => {
    try {
      await Promise.all(
        selected.map((group) =>
          client.send(new DeleteLogGroupCommand({ logGroupName: group.logGroupName })),
        ),
      );
      notify({ type: "success", content: `Deleted ${selected.length} log group(s).` });
      setSelected([]);
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't delete — ${title}`, content: detail });
    }
  };

  const query = filterText.trim();
  const matching = groups.filter((group) => {
    const name = group.logGroupName ?? "";
    if (query === "") {
      return true;
    }
    return exactMatch ? name === query : name.toLowerCase().includes(query.toLowerCase());
  });
  const pageItems = matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <ContentLayout header={<Header variant="h1">Log groups</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading log groups"
        items={pageItems}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
        trackBy={(group) => group.logGroupName ?? ""}
        header={
          <Header
            counter={loading ? undefined : `(${groups.length})`}
            description="By default, we only load up to 10,000 log groups."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                <Button disabled={selected.length === 0} onClick={() => void deleteSelected()}>
                  Delete
                </Button>
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  Create log group
                </Button>
              </SpaceBetween>
            }
          >
            Log groups
          </Header>
        }
        columnDefinitions={[
          {
            id: "name",
            header: "Log group",
            isRowHeader: true,
            cell: (group) => (
              <Link
                href={`/cloudwatch/log-groups/${encodeLogName(group.logGroupName ?? "")}`}
                onFollow={(event) => {
                  event.preventDefault();
                  navigate(
                    `/cloudwatch/log-groups/${encodeLogName(group.logGroupName ?? "")}`,
                  );
                }}
              >
                {group.logGroupName}
              </Link>
            ),
          },
          { id: "class", header: "Log class", cell: (group) => group.logGroupClass ?? "Standard" },
          {
            id: "retention",
            header: "Retention",
            cell: (group) => formatRetention(group.retentionInDays),
          },
          { id: "stored", header: "Stored bytes", cell: (group) => formatBytes(group.storedBytes) },
          {
            id: "filters",
            header: "Metric filters",
            cell: (group) => dash(group.metricFilterCount),
          },
          { id: "arn", header: "ARN", cell: (group) => dash(group.arn) },
        ]}
        filter={
          <SpaceBetween size="s" direction="horizontal" alignItems="center">
            <TextFilter
              filteringText={filterText}
              filteringPlaceholder="Filter log groups or try pattern search"
              filteringAriaLabel="Filter log groups"
              countText={query ? `${matching.length} matches` : ""}
              onChange={(event) => {
                setFilterText(event.detail.filteringText);
                setCurrentPage(1);
              }}
            />
            <Checkbox
              checked={exactMatch}
              onChange={(event) => setExactMatch(event.detail.checked)}
            >
              Exact match
            </Checkbox>
          </SpaceBetween>
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
                <Box variant="strong">Couldn't load log groups</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No log groups</Box>
                <Box variant="p" color="text-body-secondary">
                  Log groups appear here once a service writes logs, or create one directly.
                </Box>
                <Button onClick={() => setCreateOpen(true)}>Create log group</Button>
              </SpaceBetween>
            </Box>
          )
        }
      />

      <Modal
        visible={createOpen}
        onDismiss={() => setCreateOpen(false)}
        header="Create log group"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={creating}
                disabled={newName.trim() === ""}
                onClick={() => void createGroup()}
              >
                Create
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <FormField
          label="Log group name"
          description="For example, /aws/lambda/my-function."
        >
          <Input
            value={newName}
            autoFocus
            placeholder="/aws/lambda/my-function"
            onChange={(event) => setNewName(event.detail.value)}
          />
        </FormField>
      </Modal>
    </ContentLayout>
  );
}
