import { useEffect, useState } from "react";
import {
  CloudFormationClient,
  CreateStackCommand,
  UpdateStackCommand,
} from "@aws-sdk/client-cloudformation";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import Tiles from "@cloudscape-design/components/tiles";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";
import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";

const SAMPLE_TEMPLATE = `AWSTemplateFormatVersion: '2010-09-09'
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
`;

/**
 * Create or update a stack.
 *
 * AWS's version is a four-step wizard (Create stack, Specify stack details, Configure
 * stack options, Review and create). This is one form because the middle two steps are
 * mostly options LCS does not honour — rollback configuration, notification ARNs, stack
 * policies, timeouts — leaving stack name, template, parameters, tags, and capabilities.
 *
 * AWS's three template sources are all represented: Amazon S3 URL is real (CreateStack
 * honours TemplateURL, verified against a template served from an LCS bucket), uploading a
 * local file reads it into the body, and Sync from Git is shown disabled.
 * Build-from-Infrastructure-Composer is omitted — it is a console-only visual builder.
 *
 * Update reuses the same form because UpdateStack takes the same inputs.
 */
export function CreateStackModal({
  visible,
  updateStackName,
  onDismiss,
  onSubmitted,
}: {
  visible: boolean;
  /** When set, the form submits UpdateStack against this stack instead of CreateStack. */
  updateStackName?: string;
  onDismiss: () => void;
  onSubmitted: (stackName: string) => Promise<void>;
}) {
  const client = useAwsClient(CloudFormationClient);
  const { notify } = useNotifications();

  const [stackName, setStackName] = useState("");
  const [templateSource, setTemplateSource] = useState<"body" | "url">("body");
  const [templateUrl, setTemplateUrl] = useState("");
  const [templateBody, setTemplateBody] = useState(SAMPLE_TEMPLATE);
  const [parameters, setParameters] = useState<KeyValuePair[]>([]);
  const [tags, setTags] = useState<KeyValuePair[]>([]);
  const [namedIam, setNamedIam] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isUpdate = updateStackName !== undefined;

  useEffect(() => {
    if (!visible) {
      return;
    }
    setStackName(updateStackName ?? "");
    setTemplateSource("body");
    setTemplateUrl("");
    setTemplateBody(SAMPLE_TEMPLATE);
    setParameters([]);
    setTags([]);
    setNamedIam(false);
    setFormError(null);
  }, [visible, updateStackName]);

  const readTemplateFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setTemplateBody(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const submit = async () => {
    if (stackName.trim() === "") {
      setFormError("Stack name is required.");
      return;
    }
    if (templateSource === "url" && templateUrl.trim() === "") {
      setFormError("An Amazon S3 URL is required.");
      return;
    }
    if (templateSource === "body" && templateBody.trim() === "") {
      setFormError("A template body is required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      // Blank rows are the natural state of a freshly added row, so they are dropped
      // rather than sent as empty-named parameters.
      const input = {
        StackName: stackName.trim(),
        // CreateStack takes one or the other, never both.
        TemplateBody: templateSource === "body" ? templateBody : undefined,
        TemplateURL: templateSource === "url" ? templateUrl.trim() : undefined,
        Parameters: parameters
          .filter((pair) => pair.key.trim() !== "")
          .map((pair) => ({ ParameterKey: pair.key.trim(), ParameterValue: pair.value })),
        Tags: tags
          .filter((pair) => pair.key.trim() !== "")
          .map((pair) => ({ Key: pair.key.trim(), Value: pair.value })),
        Capabilities: namedIam ? ["CAPABILITY_NAMED_IAM" as const] : undefined,
      };
      await client.send(
        isUpdate ? new UpdateStackCommand(input) : new CreateStackCommand(input),
      );
      notify({
        type: "success",
        content: isUpdate
          ? `Update started for "${stackName.trim()}".`
          : `Stack "${stackName.trim()}" created.`,
      });
      await onSubmitted(stackName.trim());
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
      size="large"
      header={isUpdate ? `Update ${updateStackName}` : "Create stack"}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              {isUpdate ? "Update stack" : "Create stack"}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <FormField label="Stack name">
            <Input
              value={stackName}
              autoFocus={!isUpdate}
              disabled={isUpdate}
              placeholder="my-stack"
              onChange={(event) => setStackName(event.detail.value)}
            />
          </FormField>

          <FormField label="Template source">
            <Tiles
              value={templateSource}
              onChange={(event) => setTemplateSource(event.detail.value as "body" | "url")}
              columns={3}
              items={[
                {
                  value: "body",
                  label: "Upload a template file",
                  description: "Paste a template, or load one from disk.",
                },
                {
                  value: "url",
                  label: "Amazon S3 URL",
                  description: "Provide an Amazon S3 URL to your template.",
                },
                {
                  value: "git",
                  label: "Sync from Git",
                  description: "Not available in LCS — no Git sync backend.",
                  disabled: true,
                },
              ]}
            />
          </FormField>

          {templateSource === "url" ? (
            <FormField
              label="Amazon S3 URL"
              description="An object URL served by this emulator, such as http://localhost:4566/my-bucket/template.yaml."
            >
              <Input
                value={templateUrl}
                placeholder="http://localhost:4566/my-bucket/template.yaml"
                onChange={(event) => setTemplateUrl(event.detail.value)}
              />
            </FormField>
          ) : (
            <FormField
              label="Template"
              description="Paste a JSON or YAML template, or load one from a file."
            >
              <SpaceBetween size="s">
                <input
                  type="file"
                  accept=".yaml,.yml,.json,.template,text/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      readTemplateFile(file);
                    }
                  }}
                />
                <Textarea
                  value={templateBody}
                  rows={16}
                  spellcheck={false}
                  onChange={(event) => setTemplateBody(event.detail.value)}
                />
              </SpaceBetween>
            </FormField>
          )}

          <FormField
            label="Parameters"
            description="Values for the template's Parameters section."
          >
            <KeyValueEditor
              items={parameters}
              onChange={setParameters}
              keyLabel="Parameter key"
              valueLabel="Parameter value"
              addLabel="Add parameter"
              empty="No parameters"
            />
          </FormField>

          <FormField label="Tags">
            <KeyValueEditor
              items={tags}
              onChange={setTags}
              keyLabel="Key"
              valueLabel="Value"
              addLabel="Add tag"
              empty="No tags"
            />
          </FormField>

          <FormField label="Capabilities">
            <Checkbox checked={namedIam} onChange={(event) => setNamedIam(event.detail.checked)}>
              Acknowledge that this template may create named IAM resources
            </Checkbox>
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
