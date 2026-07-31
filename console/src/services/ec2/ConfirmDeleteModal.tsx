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

/**
 * The destructive-action confirmation AWS puts in front of a delete.
 *
 * `confirmPhrase` mirrors AWS's retype guard — the EC2 console asks for the literal word
 * "delete" before removing a VPC, subnet, or key pair. Where AWS asks only for a button
 * press (security groups, releasing an address) the phrase is omitted.
 */
export function ConfirmDeleteModal({
  visible,
  onDismiss,
  onDone,
  header,
  submitLabel,
  itemLabels,
  confirmPhrase,
  consequence,
  run,
}: {
  visible: boolean;
  onDismiss: () => void;
  onDone: () => Promise<void>;
  header: string;
  submitLabel: string;
  /** One label per resource being deleted, shown so the user can check the target. */
  itemLabels: string[];
  confirmPhrase?: string;
  consequence: string;
  run: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setTyped("");
      setFormError(null);
    }
  }, [visible]);

  const confirmed = confirmPhrase === undefined || typed.trim() === confirmPhrase;

  const submit = async () => {
    if (!confirmed) {
      setFormError(`Type "${confirmPhrase}" to confirm.`);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await run();
      await onDone();
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
      header={header}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={!confirmed}
              onClick={() => void submit()}
            >
              {submitLabel}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="m">
          <Alert type="warning">{consequence}</Alert>
          <Box>
            <Box variant="awsui-key-label">
              {itemLabels.length === 1 ? "Selected resource" : "Selected resources"}
            </Box>
            {itemLabels.map((label) => (
              <Box key={label} variant="p">
                {label}
              </Box>
            ))}
          </Box>
          {confirmPhrase !== undefined && (
            <FormField label={`To confirm deletion, type "${confirmPhrase}" in the field.`}>
              <Input
                value={typed}
                autoFocus
                placeholder={confirmPhrase}
                onChange={(event) => setTyped(event.detail.value)}
              />
            </FormField>
          )}
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
