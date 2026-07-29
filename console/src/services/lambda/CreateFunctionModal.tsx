import { useCallback, useEffect, useState } from "react";
import { CreateFunctionCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { IAMClient, ListRolesCommand } from "@aws-sdk/client-iam";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import type { SelectProps } from "@cloudscape-design/components/select";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";
import { buildSingleFileZip } from "./lambdaFormat";

interface CreateFunctionModalProps {
  visible: boolean;
  onDismiss: () => void;
  onCreated: () => Promise<void>;
}

const RUNTIMES = ["nodejs20.x", "nodejs18.x", "python3.12", "python3.11", "java21"];

const DEFAULT_CODE = `exports.handler = async (event) => {
  return { statusCode: 200, body: JSON.stringify({ ok: true, event }) };
};
`;

export function CreateFunctionModal({ visible, onDismiss, onCreated }: CreateFunctionModalProps) {
  const client = useAwsClient(LambdaClient);
  const iam = useAwsClient(IAMClient);
  const { notify } = useNotifications();

  const [name, setName] = useState("");
  const [runtime, setRuntime] = useState<SelectProps.Option>({
    label: "nodejs20.x",
    value: "nodejs20.x",
  });
  const [handler, setHandler] = useState("index.handler");
  const [roles, setRoles] = useState<SelectProps.Option[]>([]);
  const [role, setRole] = useState<SelectProps.Option | null>(null);
  const [code, setCode] = useState(DEFAULT_CODE);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadRoles = useCallback(async () => {
    try {
      const response = await iam.send(new ListRolesCommand({}));
      const options = (response.Roles ?? []).map((r) => ({
        label: r.RoleName ?? "",
        value: r.Arn ?? "",
      }));
      setRoles(options);
      // Prefer a role that already trusts Lambda, matching what the AWS wizard defaults to.
      setRole(options.find((o) => /lambda/i.test(o.label)) ?? options[0] ?? null);
    } catch {
      setRoles([]);
    }
  }, [iam]);

  useEffect(() => {
    if (visible) {
      setName("");
      setHandler("index.handler");
      setCode(DEFAULT_CODE);
      setFormError(null);
      void loadRoles();
    }
  }, [visible, loadRoles]);

  const submit = async () => {
    if (name.trim() === "") {
      setFormError("Function name is required.");
      return;
    }
    if (role === null || !role.value) {
      setFormError("An execution role is required. Create an IAM role that Lambda can assume.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await client.send(
        new CreateFunctionCommand({
          FunctionName: name.trim(),
          Runtime: runtime.value as never,
          Role: role.value,
          Handler: handler.trim(),
          Code: { ZipFile: buildSingleFileZip("index.js", code) },
        }),
      );
      notify({ type: "success", content: `Function "${name.trim()}" created.` });
      await onCreated();
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
      header="Create function"
      size="large"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Create function
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <FormField label="Function name">
            <Input
              value={name}
              autoFocus
              placeholder="my-function"
              onChange={(event) => setName(event.detail.value)}
            />
          </FormField>
          <FormField label="Runtime">
            <Select
              selectedOption={runtime}
              options={RUNTIMES.map((r) => ({ label: r, value: r }))}
              onChange={(event) => setRuntime(event.detail.selectedOption)}
            />
          </FormField>
          <FormField label="Handler">
            <Input value={handler} onChange={(event) => setHandler(event.detail.value)} />
          </FormField>
          <FormField
            label="Execution role"
            description="An IAM role Lambda assumes when it runs the function."
          >
            <Select
              selectedOption={role}
              options={roles}
              placeholder={roles.length === 0 ? "No IAM roles found" : "Choose a role"}
              onChange={(event) => setRole(event.detail.selectedOption)}
            />
          </FormField>
          <FormField
            label="Function code"
            description="Packaged as index.js in a deployment zip built in the browser."
          >
            <Textarea value={code} rows={10} onChange={(event) => setCode(event.detail.value)} />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
