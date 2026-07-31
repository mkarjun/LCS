import { useCallback, useEffect, useState } from "react";
import {
  AddUserToGroupCommand,
  AttachGroupPolicyCommand,
  CreateGroupCommand,
  ListUsersCommand,
} from "@aws-sdk/client-iam";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Multiselect from "@cloudscape-design/components/multiselect";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { MultiselectProps } from "@cloudscape-design/components/multiselect";

import { describeAwsError } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";
import { useIamClient } from "./useIamClient";
import { loadPolicyOptions, validateIamName } from "./policyPicker";

interface CreateGroupModalProps {
  visible: boolean;
  onDismiss: () => void;
  onCreated: () => void;
}

/**
 * AWS's "Create user group" page: a name, the users to put in it, and the policies to
 * attach. All three are separate API calls, so the group survives a failure in either
 * follow-up and the notification says which part did not land.
 */
export function CreateGroupModal({ visible, onDismiss, onCreated }: CreateGroupModalProps) {
  const client = useIamClient();
  const { notify } = useNotifications();

  const [name, setName] = useState("");
  const [userOptions, setUserOptions] = useState<MultiselectProps.Options>([]);
  const [users, setUsers] = useState<readonly MultiselectProps.Option[]>([]);
  const [policyOptions, setPolicyOptions] = useState<MultiselectProps.Options>([]);
  const [policies, setPolicies] = useState<readonly MultiselectProps.Option[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadOptions = useCallback(async () => {
    const [policyResult, userResult] = await Promise.allSettled([
      loadPolicyOptions(client),
      client.send(new ListUsersCommand({})),
    ]);
    setPolicyOptions(policyResult.status === "fulfilled" ? policyResult.value : []);
    setUserOptions(
      userResult.status === "fulfilled"
        ? (userResult.value.Users ?? []).map((user) => ({
            label: user.UserName ?? "",
            value: user.UserName ?? "",
          }))
        : [],
    );
  }, [client]);

  useEffect(() => {
    if (visible) {
      setName("");
      setUsers([]);
      setPolicies([]);
      setFormError(null);
      void loadOptions();
    }
  }, [visible, loadOptions]);

  const submit = async () => {
    const nameError = validateIamName(name.trim(), "User group name", 128);
    if (nameError !== null) {
      setFormError(nameError);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await client.send(new CreateGroupCommand({ GroupName: name.trim() }));
      const failed: string[] = [];
      for (const user of users) {
        try {
          await client.send(
            new AddUserToGroupCommand({
              GroupName: name.trim(),
              UserName: String(user.value),
            }),
          );
        } catch {
          failed.push(`user ${user.label}`);
        }
      }
      for (const policy of policies) {
        try {
          await client.send(
            new AttachGroupPolicyCommand({
              GroupName: name.trim(),
              PolicyArn: String(policy.value),
            }),
          );
        } catch {
          failed.push(`policy ${policy.label}`);
        }
      }
      if (failed.length > 0) {
        notify({
          type: "warning",
          header: `User group "${name.trim()}" created, with problems`,
          content: `Could not add: ${failed.join(", ")}.`,
        });
      } else {
        notify({ type: "success", content: `User group "${name.trim()}" created.` });
      }
      onCreated();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFormError(`${title}: ${detail}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Create user group"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Create user group
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <FormField
            label="User group name"
            constraintText="Up to 128 characters. Use alphanumeric and + = , . @ _ - characters."
          >
            <Input
              value={name}
              autoFocus
              placeholder="developers"
              onChange={(event) => setName(event.detail.value)}
            />
          </FormField>
          <FormField
            label="Add users to the group"
            description="Optional. Users can be added or removed later."
          >
            <Multiselect
              selectedOptions={users}
              options={userOptions}
              filteringType="auto"
              placeholder={userOptions.length === 0 ? "No users in this account" : "Choose users"}
              onChange={(event) => setUsers(event.detail.selectedOptions)}
            />
          </FormField>
          <FormField
            label="Attach permissions policies"
            description="Policies attached to the group apply to every user in it."
          >
            <Multiselect
              selectedOptions={policies}
              options={policyOptions}
              filteringType="auto"
              placeholder="Choose policies"
              onChange={(event) => setPolicies(event.detail.selectedOptions)}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
