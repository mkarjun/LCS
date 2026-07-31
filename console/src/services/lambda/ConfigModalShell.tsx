import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { describeAwsError } from "@platform/awsClient";

/** Submit state shared by the Lambda configuration edit modals. */
export function useConfigSubmit() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async (action: () => Promise<void>) => {
    setSubmitting(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setError(`${title}: ${detail}`);
      return false;
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { error, setError, submitting, submit };
}

/** Header + cancel/save footer + error banner shared by the config edit modals. */
export function ConfigModalShell({
  visible,
  onDismiss,
  header,
  submitLabel,
  onSubmit,
  submitting,
  error,
  size = "medium",
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  header: string;
  submitLabel: string;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  size?: "medium" | "large";
  children: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header={header}
      size={size}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={onSubmit}>
              {submitLabel}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={error}>
        <SpaceBetween size="l">{children}</SpaceBetween>
      </Form>
    </Modal>
  );
}
