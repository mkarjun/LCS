import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CreateDBClusterParameterGroupCommand,
  CreateDBParameterGroupCommand,
  DeleteDBClusterParameterGroupCommand,
  DeleteDBParameterGroupCommand,
  DescribeDBClusterParameterGroupsCommand,
  DescribeDBParameterGroupsCommand,
  RDSClient,
} from "@aws-sdk/client-rds";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Link from "@cloudscape-design/components/link";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Tiles from "@cloudscape-design/components/tiles";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";

interface ParameterGroupRow {
  name: string;
  family: string;
  description: string;
  type: "DB parameter group" | "DB cluster parameter group";
}

/**
 * Parameter groups.
 *
 * AWS lists instance and cluster parameter groups in one table with a Type column, which
 * is what this does. The name links to the group's parameters; the two kinds live in
 * separate API namespaces, so the link carries `?type=cluster` to pick the right pair.
 */
export default function ParameterGroupsPage() {
  const navigate = useNavigate();
  const client = useAwsClient(RDSClient);
  const { notify } = useNotifications();

  const [rows, setRows] = useState<ParameterGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ParameterGroupRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [kind, setKind] = useState<"instance" | "cluster">("instance");
  const [name, setName] = useState("");
  const [family, setFamily] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useBreadcrumbs([
    { text: "Aurora and RDS", href: "/rds" },
    { text: "Parameter groups", href: "/rds/parameter-groups" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    const [instanceResult, clusterResult] = await Promise.allSettled([
      client.send(new DescribeDBParameterGroupsCommand({})),
      client.send(new DescribeDBClusterParameterGroupsCommand({})),
    ]);
    if (instanceResult.status === "rejected") {
      const { title, detail } = describeAwsError(instanceResult.reason);
      notify({ type: "error", header: `Couldn't load parameter groups — ${title}`, content: detail });
    }
    const instanceRows: ParameterGroupRow[] =
      instanceResult.status === "fulfilled"
        ? (instanceResult.value.DBParameterGroups ?? []).map((group) => ({
            name: group.DBParameterGroupName ?? "",
            family: group.DBParameterGroupFamily ?? "—",
            description: group.Description ?? "",
            type: "DB parameter group",
          }))
        : [];
    const clusterRows: ParameterGroupRow[] =
      clusterResult.status === "fulfilled"
        ? (clusterResult.value.DBClusterParameterGroups ?? []).map((group) => ({
            name: group.DBClusterParameterGroupName ?? "",
            family: group.DBParameterGroupFamily ?? "—",
            description: group.Description ?? "",
            type: "DB cluster parameter group",
          }))
        : [];
    setRows([...instanceRows, ...clusterRows]);
    setLoading(false);
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setKind("instance");
    setName("");
    setFamily("");
    setDescription("");
    setFormError(null);
    setCreateOpen(true);
  };

  const create = async () => {
    if (name.trim() === "" || family.trim() === "") {
      setFormError("A name and a parameter group family are required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const shared = {
        DBParameterGroupFamily: family.trim(),
        Description: description.trim() === "" ? name.trim() : description.trim(),
      };
      if (kind === "cluster") {
        await client.send(
          new CreateDBClusterParameterGroupCommand({
            DBClusterParameterGroupName: name.trim(),
            ...shared,
          }),
        );
      } else {
        await client.send(
          new CreateDBParameterGroupCommand({
            DBParameterGroupName: name.trim(),
            ...shared,
          }),
        );
      }
      notify({ type: "success", content: `Parameter group "${name.trim()}" created.` });
      setCreateOpen(false);
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFormError(`${title}: ${detail}`);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    try {
      await Promise.all(
        selected.map((row) =>
          row.type === "DB cluster parameter group"
            ? client.send(
                new DeleteDBClusterParameterGroupCommand({
                  DBClusterParameterGroupName: row.name,
                }),
              )
            : client.send(new DeleteDBParameterGroupCommand({ DBParameterGroupName: row.name })),
        ),
      );
      notify({ type: "success", content: `Deleted ${selected.length} parameter group(s).` });
      setSelected([]);
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({
        type: "error",
        header: `Couldn't delete parameter group — ${title}`,
        content: detail,
      });
    }
  };

  return (
    <ContentLayout header={<Header variant="h1">Parameter groups</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading parameter groups"
        items={rows}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
        trackBy={(row) => `${row.type}:${row.name}`}
        header={
          <Header
            counter={loading ? undefined : `(${rows.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                <Button disabled={selected.length === 0} onClick={() => void remove()}>
                  Delete
                </Button>
                <Button variant="primary" onClick={openCreate}>
                  Create parameter group
                </Button>
              </SpaceBetween>
            }
          >
            Parameter groups
          </Header>
        }
        columnDefinitions={[
          {
            id: "name",
            header: "Name",
            isRowHeader: true,
            cell: (row) => {
              const href = `/rds/parameter-groups/${row.name}${
                row.type === "DB cluster parameter group" ? "?type=cluster" : ""
              }`;
              return (
                <Link
                  href={href}
                  onFollow={(event) => {
                    event.preventDefault();
                    navigate(href);
                  }}
                >
                  {row.name}
                </Link>
              );
            },
          },
          { id: "family", header: "Family", cell: (row) => row.family },
          { id: "type", header: "Type", cell: (row) => row.type },
          { id: "description", header: "Description", cell: (row) => row.description },
        ]}
        empty={
          <Box textAlign="center" padding={{ vertical: "l" }}>
            <SpaceBetween size="s">
              <Box variant="strong">No parameter groups</Box>
              <Button onClick={openCreate}>Create parameter group</Button>
            </SpaceBetween>
          </Box>
        }
      />

      <Modal
        visible={createOpen}
        onDismiss={() => setCreateOpen(false)}
        header="Create parameter group"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setCreateOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button variant="primary" loading={submitting} onClick={() => void create()}>
                Create
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Form errorText={formError}>
          <SpaceBetween size="l">
            <FormField label="Type">
              <Tiles
                value={kind}
                onChange={(event) => setKind(event.detail.value as "instance" | "cluster")}
                items={[
                  { value: "instance", label: "DB parameter group" },
                  { value: "cluster", label: "DB cluster parameter group" },
                ]}
              />
            </FormField>
            <FormField label="Name">
              <Input
                value={name}
                autoFocus
                placeholder="my-parameter-group"
                onChange={(event) => setName(event.detail.value)}
              />
            </FormField>
            <FormField
              label="Parameter group family"
              description="The engine and major version the group applies to, such as postgres16."
            >
              <Input
                value={family}
                placeholder="postgres16"
                onChange={(event) => setFamily(event.detail.value)}
              />
            </FormField>
            <FormField label="Description">
              <Input
                value={description}
                onChange={(event) => setDescription(event.detail.value)}
              />
            </FormField>
          </SpaceBetween>
        </Form>
      </Modal>
    </ContentLayout>
  );
}
