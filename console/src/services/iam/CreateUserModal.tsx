import { useEffect, useState } from "react";
import { CreateUserCommand } from "@aws-sdk/client-iam";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { describeAwsError } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";
import { useIamClient } from "./useIamClient";

interface CreateUserModalProps {
  visible: boolean;
  onDismiss: () => void;
  onCreated: () => void;
}

/** IAM's documented user-name rules, so the console rejects what the API would. */
function validateUserName(name: string): string | null {
  if (name === "") {
    return "User name is required.";
  }
  if (name.length > 64) {
    return "User name can be up to 64 characters.";
  }
  if (!/^[\w+=,.@-]+$/.test(name)) {
    return "User name can use only alphanumeric characters and + = , . @ _ -";
  }
  return null;
}

export function CreateUserModal({ visible, onDismiss, onCreated }: CreateUserModalProps) {
  const client = useIamClient();
  const { notify } = useNotifications();
  const [name, setName] = useState("");
  const [path, setPath] = useState("/");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setName("");
      setPath("/");
      setError(null);
      setFormError(null);
      setTouched(false);
    }
  }, [visible]);

  const submit = async () => {
    setTouched(true);
    const message = validateUserName(name.trim());
    setError(message);
    if (message !== null) {
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await client.send(
        new CreateUserCommand({ UserName: name.trim(), Path: path.trim() || "/" }),
      );
      notify({ type: "success", content: `User "${name.trim()}" created.` });
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
      header="Create user"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Create user
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <FormField
            label="User name"
            errorText={touched ? error : null}
            constraintText="Up to 64 characters. Use alphanumeric and + = , . @ _ - characters."
          >
            <Input
              value={name}
              autoFocus
              onChange={(event) => {
                setName(event.detail.value);
                if (touched) {
                  setError(validateUserName(event.detail.value.trim()));
                }
              }}
              onBlur={() => {
                setTouched(true);
                setError(validateUserName(name.trim()));
              }}
            />
          </FormField>
          <FormField label="Path" description="Used to organize and group users.">
            <Input value={path} onChange={(event) => setPath(event.detail.value)} />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
