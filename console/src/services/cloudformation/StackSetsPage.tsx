import { useCallback, useEffect, useState } from "react";
import {
  CloudFormationClient,
  CreateStackSetCommand,
  DeleteStackSetCommand,
  ListStackSetsCommand,
} from "@aws-sdk/client-cloudformation";
import type { StackSetSummary } from "@aws-sdk/client-cloudformation";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Textarea from "@cloudscape-design/components/textarea";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { cfnStatusIndicator } from "./cfnFormat";

const SAMPLE_TEMPLATE = `AWSTemplateFormatVersion: '2010-09-09'
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
`;

/**
 * StackSets.
 *
 * AWS's create flow is a multi-step wizard covering permission models, deployment targets,
 * and rollout options. LCS has a single account and Region set, so this creates the stack
 * set from a template and leaves instance provisioning to the detail page.
 */
export default function StackSetsPage() {
  const client = useAwsClient(CloudFormationClient);
  const { notify } = useNotifications();

  const [stackSets, setStackSets] = useState<StackSetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<StackSetSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateBody, setTemplateBody] = useState(SAMPLE_TEMPLATE);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useBreadcrumbs([
    { text: "CloudFormation", href: "/cloudformation" },
    { text: "StackSets", href: "/cloudformation/stacksets" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(new ListStackSetsCommand({}));
      setStackSets(response.Summaries ?? []);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load StackSets — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setName("");
    setDescription("");
    setTemplateBody(SAMPLE_TEMPLATE);
    setFormError(null);
    setCreateOpen(true);
  };

  const create = async () => {
    if (name.trim() === "") {
      setFormError("StackSet name is required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await client.send(
        new CreateStackSetCommand({
          StackSetName: name.trim(),
          Description: description.trim() === "" ? undefined : description.trim(),
          TemplateBody: templateBody,
        }),
      );
      notify({ type: "success", content: `StackSet "${name.trim()}" created.` });
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
        selected.map((stackSet) =>
          client.send(new DeleteStackSetCommand({ StackSetName: stackSet.StackSetName })),
        ),
      );
      notify({ type: "success", content: `Deleted ${selected.length} StackSet(s).` });
      setSelected([]);
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't delete StackSet — ${title}`, content: detail });
    }
  };

  return (
    <ContentLayout header={<Header variant="h1">StackSets</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading StackSets"
        items={stackSets}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
        trackBy={(stackSet) => stackSet.StackSetName ?? ""}
        header={
          <Header
            counter={loading ? undefined : `(${stackSets.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                <Button disabled={selected.length === 0} onClick={() => void remove()}>
                  Delete
                </Button>
                <Button variant="primary" onClick={openCreate}>
                  Create StackSet
                </Button>
              </SpaceBetween>
            }
          >
            StackSets
          </Header>
        }
        columnDefinitions={[
          {
            id: "name",
            header: "StackSet name",
            isRowHeader: true,
            cell: (stackSet) => stackSet.StackSetName ?? "—",
          },
          {
            id: "status",
            header: "Status",
            cell: (stackSet) => cfnStatusIndicator(stackSet.Status),
          },
          {
            id: "description",
            header: "Description",
            cell: (stackSet) => stackSet.Description ?? "—",
          },
        ]}
        empty={
          <Box textAlign="center" padding={{ vertical: "l" }}>
            <SpaceBetween size="s">
              <Box variant="strong">No StackSets</Box>
              <Box variant="p" color="text-body-secondary">
                A StackSet deploys one template as stacks across accounts and Regions.
              </Box>
              <Button onClick={openCreate}>Create StackSet</Button>
            </SpaceBetween>
          </Box>
        }
      />

      <Modal
        visible={createOpen}
        onDismiss={() => setCreateOpen(false)}
        size="large"
        header="Create StackSet"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setCreateOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button variant="primary" loading={submitting} onClick={() => void create()}>
                Create StackSet
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Form errorText={formError}>
          <SpaceBetween size="l">
            <FormField label="StackSet name">
              <Input
                value={name}
                autoFocus
                placeholder="my-stackset"
                onChange={(event) => setName(event.detail.value)}
              />
            </FormField>
            <FormField label="Description - optional">
              <Input
                value={description}
                onChange={(event) => setDescription(event.detail.value)}
              />
            </FormField>
            <FormField label="Template">
              <Textarea
                value={templateBody}
                rows={16}
                spellcheck={false}
                onChange={(event) => setTemplateBody(event.detail.value)}
              />
            </FormField>
          </SpaceBetween>
        </Form>
      </Modal>
    </ContentLayout>
  );
}
