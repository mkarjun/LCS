import { useCallback, useEffect, useState } from "react";
import { CreateFunctionCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { AttachRolePolicyCommand, IAMClient, ListRolesCommand } from "@aws-sdk/client-iam";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Multiselect from "@cloudscape-design/components/multiselect";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import type { MultiselectProps } from "@cloudscape-design/components/multiselect";
import type { SelectProps } from "@cloudscape-design/components/select";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";
import { buildSingleFileZip } from "./lambdaFormat";
import { createBasicExecutionRole } from "./executionRole";

interface CreateFunctionModalProps {
  visible: boolean;
  onDismiss: () => void;
  onCreated: () => Promise<void>;
}

const RUNTIMES = ["nodejs20.x", "nodejs18.x", "python3.12", "python3.11", "java21"];

/**
 * The extra managed policies AWS offers behind "Create a new role from AWS policy
 * templates". Each one is a real policy in this emulator's managed-policy catalogue, so
 * attaching it succeeds; LCS does not enforce IAM on Lambda's own calls, so they document
 * intent more than they grant access.
 */
const POLICY_TEMPLATES: MultiselectProps.Option[] = [
  {
    label: "Amazon SQS poller permissions",
    value: "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole",
    description: "Read and delete messages from an SQS queue.",
  },
  {
    label: "Amazon DynamoDB stream poller permissions",
    value: "arn:aws:iam::aws:policy/service-role/AWSLambdaDynamoDBExecutionRole",
    description: "Read records from a DynamoDB stream.",
  },
  {
    label: "Amazon Kinesis stream poller permissions",
    value: "arn:aws:iam::aws:policy/service-role/AWSLambdaKinesisExecutionRole",
    description: "Read records from a Kinesis stream.",
  },
  {
    label: "VPC access permissions",
    value: "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
    description: "Manage the network interfaces a VPC-attached function needs.",
  },
];

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
  const [roleSource, setRoleSource] = useState("create");
  const [roles, setRoles] = useState<SelectProps.Option[]>([]);
  const [role, setRole] = useState<SelectProps.Option | null>(null);
  const [templates, setTemplates] = useState<readonly MultiselectProps.Option[]>([]);
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
      setRoleSource("create");
      setTemplates([]);
      setCode(DEFAULT_CODE);
      setFormError(null);
      void loadRoles();
    }
  }, [visible, loadRoles]);

  /**
   * Resolves the execution role, creating one first when asked to.
   *
   * This is the step the AWS console performs on your behalf and the reason a fresh
   * account can create a function at all: CreateFunction rejects a missing role, and a new
   * account has no roles to choose from.
   */
  const resolveRoleArn = async (functionName: string): Promise<string> => {
    if (roleSource === "existing") {
      if (role === null || !role.value) {
        throw new Error("Choose an existing execution role, or let Lambda create one.");
      }
      return role.value;
    }
    const created = await createBasicExecutionRole(iam, functionName);
    for (const template of templates) {
      try {
        await iam.send(
          new AttachRolePolicyCommand({
            RoleName: created.roleName,
            PolicyArn: String(template.value),
          }),
        );
      } catch {
        // Reported below alongside the basic policy result rather than failing the create.
      }
    }
    notify({
      type: created.policyAttached ? "info" : "warning",
      header: `Execution role "${created.roleName}" created`,
      content: created.policyAttached
        ? "The role trusts Lambda and carries AWSLambdaBasicExecutionRole."
        : "The role trusts Lambda, but AWSLambdaBasicExecutionRole could not be attached — the function will not be able to write logs.",
    });
    return created.roleArn;
  };

  const submit = async () => {
    const functionName = name.trim();
    if (functionName === "") {
      setFormError("Function name is required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const roleArn = await resolveRoleArn(functionName);
      await client.send(
        new CreateFunctionCommand({
          FunctionName: functionName,
          Runtime: runtime.value as never,
          Role: roleArn,
          Handler: handler.trim(),
          Code: { ZipFile: buildSingleFileZip("index.js", code) },
        }),
      );
      notify({ type: "success", content: `Function "${functionName}" created.` });
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
          <ExpandableSection headerText="Change default execution role" defaultExpanded>
            <SpaceBetween size="m">
              <FormField
                label="Execution role"
                description="The IAM role Lambda assumes when it runs the function."
              >
                <RadioGroup
                  value={roleSource}
                  onChange={(event) => setRoleSource(event.detail.value)}
                  items={[
                    {
                      value: "create",
                      label: "Create a new role with basic Lambda permissions",
                      description:
                        "Creates a role that trusts Lambda and can write to CloudWatch Logs.",
                    },
                    {
                      value: "existing",
                      label: "Use an existing role",
                      description:
                        roles.length === 0
                          ? "No IAM roles exist in this account yet."
                          : "Choose a role that Lambda is allowed to assume.",
                      disabled: roles.length === 0,
                    },
                  ]}
                />
              </FormField>
              {roleSource === "existing" && (
                <FormField label="Existing role">
                  <Select
                    selectedOption={role}
                    options={roles}
                    placeholder="Choose a role"
                    onChange={(event) => setRole(event.detail.selectedOption)}
                  />
                </FormField>
              )}
              {roleSource === "create" && (
                <FormField
                  label="Additional policy templates"
                  description="Optional. Attaches AWS's Lambda service-role policies to the new role."
                >
                  <Multiselect
                    selectedOptions={templates}
                    options={POLICY_TEMPLATES}
                    placeholder="Choose policy templates"
                    onChange={(event) => setTemplates(event.detail.selectedOptions)}
                  />
                </FormField>
              )}
            </SpaceBetween>
          </ExpandableSection>
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
