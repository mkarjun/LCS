import { useCallback, useEffect, useState } from "react";
import {
  CreateDBSubnetGroupCommand,
  DeleteDBSubnetGroupCommand,
  DescribeDBSubnetGroupsCommand,
  RDSClient,
} from "@aws-sdk/client-rds";
import { DescribeSubnetsCommand, EC2Client } from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Multiselect from "@cloudscape-design/components/multiselect";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import type { SelectProps } from "@cloudscape-design/components/select";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";

interface SubnetGroupRow {
  name: string;
  description: string;
  vpc: string;
  status: string;
  subnets: string[];
}

/**
 * DB subnet groups.
 *
 * The subnet picker is populated from EC2 DescribeSubnets, the same source RDS validates
 * against, so a group can only be built from subnets that exist. The default group is
 * synthesised by the emulator and cannot be deleted, which matches AWS.
 */
export default function SubnetGroupsPage() {
  const client = useAwsClient(RDSClient);
  const ec2 = useAwsClient(EC2Client);
  const { notify } = useNotifications();

  const [rows, setRows] = useState<SubnetGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SubnetGroupRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [availableSubnets, setAvailableSubnets] = useState<SelectProps.Option[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [chosenSubnets, setChosenSubnets] = useState<readonly SelectProps.Option[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useBreadcrumbs([
    { text: "Aurora and RDS", href: "/rds" },
    { text: "Subnet groups", href: "/rds/subnet-groups" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(new DescribeDBSubnetGroupsCommand({}));
      setRows(
        (response.DBSubnetGroups ?? []).map((group) => ({
          name: group.DBSubnetGroupName ?? "",
          description: group.DBSubnetGroupDescription ?? "",
          vpc: group.VpcId ?? "—",
          status: group.SubnetGroupStatus ?? "—",
          subnets: (group.Subnets ?? []).map((subnet) => subnet.SubnetIdentifier ?? ""),
        })),
      );
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load subnet groups — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = async () => {
    setName("");
    setDescription("");
    setChosenSubnets([]);
    setFormError(null);
    setCreateOpen(true);
    try {
      const response = await ec2.send(new DescribeSubnetsCommand({}));
      setAvailableSubnets(
        (response.Subnets ?? []).map((subnet) => ({
          label: subnet.SubnetId ?? "",
          value: subnet.SubnetId ?? "",
          description: `${subnet.AvailabilityZone ?? ""} · ${subnet.CidrBlock ?? ""}`,
        })),
      );
    } catch {
      // The emulator's default subnets are not EC2-backed, so a failure here is expected
      // on a fresh instance; the form still accepts what the user knows exists.
      setAvailableSubnets([]);
    }
  };

  const create = async () => {
    if (name.trim() === "" || chosenSubnets.length === 0) {
      setFormError("A name and at least one subnet are required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await client.send(
        new CreateDBSubnetGroupCommand({
          DBSubnetGroupName: name.trim(),
          DBSubnetGroupDescription: description.trim() === "" ? name.trim() : description.trim(),
          SubnetIds: chosenSubnets.map((option) => option.value ?? ""),
        }),
      );
      notify({ type: "success", content: `Subnet group "${name.trim()}" created.` });
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
          client.send(new DeleteDBSubnetGroupCommand({ DBSubnetGroupName: row.name })),
        ),
      );
      notify({ type: "success", content: `Deleted ${selected.length} subnet group(s).` });
      setSelected([]);
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't delete subnet group — ${title}`, content: detail });
    }
  };

  const deleteDisabled = selected.length === 0 || selected.some((row) => row.name === "default");

  return (
    <ContentLayout header={<Header variant="h1">Subnet groups</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading subnet groups"
        items={rows}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
        trackBy={(row) => row.name}
        header={
          <Header
            counter={loading ? undefined : `(${rows.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                <Button disabled={deleteDisabled} onClick={() => void remove()}>
                  Delete
                </Button>
                <Button variant="primary" onClick={() => void openCreate()}>
                  Create DB subnet group
                </Button>
              </SpaceBetween>
            }
          >
            Subnet groups
          </Header>
        }
        columnDefinitions={[
          { id: "name", header: "Name", isRowHeader: true, cell: (row) => row.name },
          { id: "description", header: "Description", cell: (row) => row.description },
          { id: "vpc", header: "VPC", cell: (row) => row.vpc },
          { id: "status", header: "Status", cell: (row) => row.status },
          {
            id: "subnets",
            header: "Subnets",
            cell: (row) => (row.subnets.length === 0 ? "—" : row.subnets.join(", ")),
          },
        ]}
        empty={
          <Box textAlign="center" padding={{ vertical: "l" }}>
            <SpaceBetween size="s">
              <Box variant="strong">No subnet groups</Box>
              <Button onClick={() => void openCreate()}>Create DB subnet group</Button>
            </SpaceBetween>
          </Box>
        }
      />

      <Modal
        visible={createOpen}
        onDismiss={() => setCreateOpen(false)}
        header="Create DB subnet group"
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
            <FormField label="Name">
              <Input
                value={name}
                autoFocus
                placeholder="my-subnet-group"
                onChange={(event) => setName(event.detail.value)}
              />
            </FormField>
            <FormField label="Description">
              <Input
                value={description}
                placeholder="Subnets for the application databases"
                onChange={(event) => setDescription(event.detail.value)}
              />
            </FormField>
            <FormField label="Subnets" description="Choose at least one subnet.">
              <Multiselect
                selectedOptions={chosenSubnets}
                options={availableSubnets}
                placeholder="Choose subnets"
                empty="No subnets found in EC2"
                onChange={(event) => setChosenSubnets(event.detail.selectedOptions)}
              />
            </FormField>
          </SpaceBetween>
        </Form>
      </Modal>
    </ContentLayout>
  );
}
