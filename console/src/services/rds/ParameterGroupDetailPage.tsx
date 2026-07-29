import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  DescribeDBClusterParametersCommand,
  DescribeDBParametersCommand,
  ModifyDBClusterParameterGroupCommand,
  ModifyDBParameterGroupCommand,
  RDSClient,
} from "@aws-sdk/client-rds";
import type { Parameter } from "@aws-sdk/client-rds";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";

/**
 * Parameter group detail.
 *
 * AWS lists every engine parameter with its default and lets you override a subset. LCS
 * stores no engine defaults, so a group holds only the parameters that have been written
 * to it and the table starts empty. Editing works: the `Parameters.Parameter.N` request
 * encoding the AWS SDKs use is now parsed, and the values read back through
 * DescribeDBParameters.
 *
 * The `type` search param selects the API pair — DB parameter groups and DB cluster
 * parameter groups are separate namespaces with the same shape.
 */
export default function ParameterGroupDetailPage() {
  const { groupName = "" } = useParams();
  const [searchParams] = useSearchParams();
  const client = useAwsClient(RDSClient);
  const { notify } = useNotifications();

  const isCluster = searchParams.get("type") === "cluster";

  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterText, setFilterText] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editValue, setEditValue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useBreadcrumbs([
    { text: "Aurora and RDS", href: "/rds" },
    { text: "Parameter groups", href: "/rds/parameter-groups" },
    { text: groupName, href: `/rds/parameter-groups/${groupName}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = isCluster
        ? await client.send(
            new DescribeDBClusterParametersCommand({ DBClusterParameterGroupName: groupName }),
          )
        : await client.send(new DescribeDBParametersCommand({ DBParameterGroupName: groupName }));
      setParameters(response.Parameters ?? []);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load parameters — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, groupName, isCluster, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (parameter?: Parameter) => {
    setEditName(parameter?.ParameterName ?? "");
    setEditValue(parameter?.ParameterValue ?? "");
    setFormError(null);
    setEditOpen(true);
  };

  const save = async () => {
    if (editName.trim() === "") {
      setFormError("A parameter name is required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const parameter = {
        ParameterName: editName.trim(),
        ParameterValue: editValue,
        ApplyMethod: "pending-reboot" as const,
      };
      // The two commands have incompatible input types, so each send is its own call
      // rather than a ternary the SDK's generics reject.
      if (isCluster) {
        await client.send(
          new ModifyDBClusterParameterGroupCommand({
            DBClusterParameterGroupName: groupName,
            Parameters: [parameter],
          }),
        );
      } else {
        await client.send(
          new ModifyDBParameterGroupCommand({
            DBParameterGroupName: groupName,
            Parameters: [parameter],
          }),
        );
      }
      notify({ type: "success", content: `Parameter "${editName.trim()}" saved.` });
      setEditOpen(false);
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFormError(`${title}: ${detail}`);
    } finally {
      setSubmitting(false);
    }
  };

  const query = filterText.trim().toLowerCase();
  const matching = parameters.filter((parameter) =>
    query === "" ? true : (parameter.ParameterName ?? "").toLowerCase().includes(query),
  );

  return (
    <ContentLayout header={<Header variant="h1">{groupName}</Header>}>
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Summary</Header>}>
          <ColumnLayout columns={2} variant="text-grid">
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Name</Box>
              <Box>{groupName}</Box>
            </SpaceBetween>
            <SpaceBetween size="xxs">
              <Box variant="awsui-key-label">Type</Box>
              <Box>{isCluster ? "DB cluster parameter group" : "DB parameter group"}</Box>
            </SpaceBetween>
          </ColumnLayout>
        </Container>

        <Alert type="info">
          LCS stores no engine defaults, so this group lists only parameters that have been
          set on it. AWS shows the engine's full parameter set with defaults.
        </Alert>

        <Table
          variant="container"
          loading={loading}
          loadingText="Loading parameters"
          items={matching}
          trackBy={(parameter) => parameter.ParameterName ?? ""}
          header={
            <Header
              counter={loading ? undefined : `(${parameters.length})`}
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                  <Button variant="primary" onClick={() => openEdit()}>
                    Edit parameter
                  </Button>
                </SpaceBetween>
              }
            >
              Parameters
            </Header>
          }
          columnDefinitions={[
            {
              id: "name",
              header: "Name",
              isRowHeader: true,
              cell: (parameter) => parameter.ParameterName ?? "—",
            },
            { id: "value", header: "Value", cell: (parameter) => parameter.ParameterValue ?? "—" },
            {
              id: "modifiable",
              header: "Modifiable",
              cell: (parameter) => (parameter.IsModifiable ? "Yes" : "No"),
            },
            {
              id: "edit",
              header: "",
              cell: (parameter) => (
                <Button variant="inline-link" onClick={() => openEdit(parameter)}>
                  Edit
                </Button>
              ),
            },
          ]}
          filter={
            <TextFilter
              filteringText={filterText}
              filteringPlaceholder="Filter parameters"
              filteringAriaLabel="Filter parameters"
              countText={query ? `${matching.length} matches` : ""}
              onChange={(event) => setFilterText(event.detail.filteringText)}
            />
          }
          empty={
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No parameters set</Box>
                <Box variant="p" color="text-body-secondary">
                  Set a parameter to override the engine default on databases using this
                  group.
                </Box>
                <Button onClick={() => openEdit()}>Edit parameter</Button>
              </SpaceBetween>
            </Box>
          }
        />
      </SpaceBetween>

      <Modal
        visible={editOpen}
        onDismiss={() => setEditOpen(false)}
        header="Edit parameter"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setEditOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button variant="primary" loading={submitting} onClick={() => void save()}>
                Save changes
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Form errorText={formError}>
          <SpaceBetween size="l">
            <FormField label="Parameter name">
              <Input
                value={editName}
                autoFocus
                placeholder="max_connections"
                onChange={(event) => setEditName(event.detail.value)}
              />
            </FormField>
            <FormField
              label="Value"
              description="Applied with ApplyMethod pending-reboot, as AWS does for static parameters."
            >
              <Input
                value={editValue}
                placeholder="150"
                onChange={(event) => setEditValue(event.detail.value)}
              />
            </FormField>
          </SpaceBetween>
        </Form>
      </Modal>
    </ContentLayout>
  );
}
