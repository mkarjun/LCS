import type { ReactNode } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";

/**
 * Modal chrome shared by the EC2 create forms — header, cancel/primary footer, and the
 * form-level error banner. Only the fields differ between them, so only the fields live
 * in each modal.
 */
export function CreateModalShell({
  visible,
  onDismiss,
  header,
  submitLabel,
  onSubmit,
  submitting,
  formError,
  size = "medium",
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  header: string;
  submitLabel: string;
  onSubmit: () => void;
  submitting: boolean;
  formError: string | null;
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
      <Form errorText={formError}>
        <SpaceBetween size="l">{children}</SpaceBetween>
      </Form>
    </Modal>
  );
}
