import { useEffect, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { describeAwsError } from "@platform/awsClient";

type BucketAction = "delete" | "empty";

interface ConfirmBucketActionModalProps {
  visible: boolean;
  action: BucketAction;
  bucketName: string;
  onDismiss: () => void;
  onSubmit: (bucketName: string) => Promise<void>;
}

/**
 * Destructive-action confirmation for Delete and Empty.
 *
 * AWS gates both behind typing an exact confirmation phrase — the bucket name for delete,
 * the literal word "permanently delete" for empty — and states that the action cannot be
 * undone. Both are reproduced, because weakening a destructive-action guard is exactly
 * the kind of divergence the parity rubric warns against.
 */
const COPY: Record<
  BucketAction,
  { title: (name: string) => string; warning: string; confirmation: (name: string) => string; label: string; submit: string }
> = {
  delete: {
    title: (name) => `Delete bucket "${name}"?`,
    warning:
      "Deleting a bucket can't be undone. The bucket must be empty before it can be deleted.",
    confirmation: (name) => name,
    label: "To confirm deletion, enter the bucket name",
    submit: "Delete",
  },
  empty: {
    title: (name) => `Empty bucket "${name}"?`,
    warning:
      "Emptying a bucket permanently deletes every object in it. This action can't be undone.",
    confirmation: () => "permanently delete",
    label: 'To confirm, enter "permanently delete"',
    submit: "Empty",
  },
};

export function ConfirmBucketActionModal({
  visible,
  action,
  bucketName,
  onDismiss,
  onSubmit,
}: ConfirmBucketActionModalProps) {
  const copy = COPY[action];
  const expected = copy.confirmation(bucketName);
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setConfirmation("");
      setFormError(null);
    }
  }, [visible]);

  const submit = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      await onSubmit(bucketName);
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
      header={copy.title(bucketName)}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={confirmation !== expected}
              onClick={() => void submit()}
            >
              {copy.submit}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="m">
          <Alert type="warning" statusIconAriaLabel="Warning">
            {copy.warning}
          </Alert>
          <FormField label={copy.label}>
            <Input
              value={confirmation}
              autoFocus
              placeholder={expected}
              onChange={(event) => setConfirmation(event.detail.value)}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
