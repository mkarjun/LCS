import { useEffect, useState } from "react";
import { CreatePolicyCommand } from "@aws-sdk/client-iam";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";

import { describeAwsError } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";
import { useIamClient } from "./useIamClient";
import { validateIamName, validatePolicyDocument } from "./policyPicker";

interface CreatePolicyModalProps {
  visible: boolean;
  onDismiss: () => void;
  onCreated: () => void;
}

const TEMPLATE = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VisualEditor0",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": "*"
    }
  ]
}
`;

/**
 * AWS's "Create policy" page, JSON tab only.
 *
 * AWS's visual editor builds the same document from a service/action/resource picker
 * driven by its service-authorization reference. LCS has no equivalent catalogue of
 * actions and conditions per service, so a visual editor here would either be a
 * hand-maintained subset that silently omits actions or a free-text field pretending to be
 * a picker. The JSON tab is what AWS itself falls back to.
 */
export function CreatePolicyModal({ visible, onDismiss, onCreated }: CreatePolicyModalProps) {
  const client = useIamClient();
  const { notify } = useNotifications();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [document, setDocument] = useState(TEMPLATE);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setName("");
      setDescription("");
      setDocument(TEMPLATE);
      setFormError(null);
    }
  }, [visible]);

  const submit = async () => {
    const nameError = validateIamName(name.trim(), "Policy name", 128);
    if (nameError !== null) {
      setFormError(nameError);
      return;
    }
    const documentError = validatePolicyDocument(document);
    if (documentError !== null) {
      setFormError(documentError);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await client.send(
        new CreatePolicyCommand({
          PolicyName: name.trim(),
          PolicyDocument: document,
          ...(description.trim() === "" ? {} : { Description: description.trim() }),
        }),
      );
      notify({ type: "success", content: `Policy "${name.trim()}" created.` });
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
      header="Create policy"
      size="large"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Create policy
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <FormField
            label="Policy name"
            constraintText="Up to 128 characters. Use alphanumeric and + = , . @ _ - characters."
          >
            <Input
              value={name}
              autoFocus
              placeholder="my-policy"
              onChange={(event) => setName(event.detail.value)}
            />
          </FormField>
          <FormField label="Description" description="Cannot be edited after the policy is created.">
            <Input
              value={description}
              placeholder="Read-only access to the reports bucket"
              onChange={(event) => setDescription(event.detail.value)}
            />
          </FormField>
          <FormField
            label="Policy document"
            description="A JSON policy document. The visual editor is not available in LCS."
          >
            <Textarea
              value={document}
              rows={18}
              onChange={(event) => setDocument(event.detail.value)}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
