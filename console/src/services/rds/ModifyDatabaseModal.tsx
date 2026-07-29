import { useCallback, useEffect, useState } from "react";
import {
  DescribeDBInstancesCommand,
  DescribeDBSubnetGroupsCommand,
  ModifyDBInstanceCommand,
  RDSClient,
} from "@aws-sdk/client-rds";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { SelectProps } from "@cloudscape-design/components/select";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";

/**
 * Modify DB instance.
 *
 * AWS's modify page covers most of the create form. ModifyDBInstance here honours only
 * the master password, IAM database authentication, and the subnet group — instance
 * class and allocated storage are accepted by the API but silently ignored, so they are
 * not offered rather than presented as controls that appear to work.
 */
export function ModifyDatabaseModal({
  instanceId,
  onDismiss,
  onModified,
}: {
  /** Null when closed; the modal loads current values whenever it changes. */
  instanceId: string | null;
  onDismiss: () => void;
  onModified: () => Promise<void>;
}) {
  const client = useAwsClient(RDSClient);
  const { notify } = useNotifications();

  const [subnetGroups, setSubnetGroups] = useState<string[]>([]);
  const [subnetGroup, setSubnetGroup] = useState<SelectProps.Option | null>(null);
  const [password, setPassword] = useState("");
  const [iamAuth, setIamAuth] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(
    async (id: string) => {
      const [instanceResult, subnetResult] = await Promise.allSettled([
        client.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: id })),
        client.send(new DescribeDBSubnetGroupsCommand({})),
      ]);
      if (instanceResult.status === "fulfilled") {
        const instance = instanceResult.value.DBInstances?.[0];
        setIamAuth(instance?.IAMDatabaseAuthenticationEnabled ?? false);
        const name = instance?.DBSubnetGroup?.DBSubnetGroupName;
        setSubnetGroup(name ? { label: name, value: name } : null);
      }
      if (subnetResult.status === "fulfilled") {
        setSubnetGroups(
          (subnetResult.value.DBSubnetGroups ?? [])
            .map((group) => group.DBSubnetGroupName ?? "")
            .filter((name) => name !== ""),
        );
      }
    },
    [client],
  );

  useEffect(() => {
    if (instanceId === null) {
      return;
    }
    setPassword("");
    setFormError(null);
    void load(instanceId);
  }, [instanceId, load]);

  const submit = async () => {
    if (instanceId === null) {
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await client.send(
        new ModifyDBInstanceCommand({
          DBInstanceIdentifier: instanceId,
          // An empty field means "leave the password alone", so it is omitted entirely.
          MasterUserPassword: password.trim() === "" ? undefined : password,
          EnableIAMDatabaseAuthentication: iamAuth,
          DBSubnetGroupName: subnetGroup?.value,
        }),
      );
      notify({ type: "success", content: `Database "${instanceId}" modified.` });
      await onModified();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFormError(`${title}: ${detail}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={instanceId !== null}
      onDismiss={onDismiss}
      header={instanceId === null ? "Modify DB instance" : `Modify ${instanceId}`}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Modify
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <Alert type="info">
            Changes apply immediately. Instance class and allocated storage cannot be changed
            after creation here.
          </Alert>

          <FormField
            label="New master password - optional"
            description="Leave empty to keep the current password."
          >
            <Input
              value={password}
              type="password"
              onChange={(event) => setPassword(event.detail.value)}
            />
          </FormField>

          <FormField label="Subnet group">
            <Select
              selectedOption={subnetGroup}
              options={subnetGroups.map((name) => ({ label: name, value: name }))}
              onChange={(event) => setSubnetGroup(event.detail.selectedOption)}
            />
          </FormField>

          <FormField label="Database authentication">
            <Checkbox checked={iamAuth} onChange={(event) => setIamAuth(event.detail.checked)}>
              Enable IAM database authentication
            </Checkbox>
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
