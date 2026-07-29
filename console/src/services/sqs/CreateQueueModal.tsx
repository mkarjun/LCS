import { useEffect, useState } from "react";
import { CreateQueueCommand, SQSClient } from "@aws-sdk/client-sqs";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import RadioGroup from "@cloudscape-design/components/radio-group";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";

export function CreateQueueModal({
  visible,
  onDismiss,
  onCreated,
}: {
  visible: boolean;
  onDismiss: () => void;
  onCreated: () => Promise<void>;
}) {
  const client = useAwsClient(SQSClient);
  const { notify } = useNotifications();

  const [name, setName] = useState("");
  const [type, setType] = useState("standard");
  const [visibilityTimeout, setVisibilityTimeout] = useState("30");
  const [retention, setRetention] = useState("345600");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setName("");
      setType("standard");
      setVisibilityTimeout("30");
      setRetention("345600");
      setFormError(null);
    }
  }, [visible]);

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setFormError("Queue name is required.");
      return;
    }
    // SQS requires FIFO queue names to end in .fifo; append it rather than fail late.
    const finalName =
      type === "fifo" && !trimmed.endsWith(".fifo") ? `${trimmed}.fifo` : trimmed;

    setSubmitting(true);
    setFormError(null);
    try {
      await client.send(
        new CreateQueueCommand({
          QueueName: finalName,
          Attributes: {
            VisibilityTimeout: visibilityTimeout,
            MessageRetentionPeriod: retention,
            ...(type === "fifo" ? { FifoQueue: "true" } : {}),
          },
        }),
      );
      notify({ type: "success", content: `Queue "${finalName}" created.` });
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
      header="Create queue"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Create queue
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <FormField label="Type">
            <RadioGroup
              value={type}
              onChange={(event) => setType(event.detail.value)}
              items={[
                {
                  value: "standard",
                  label: "Standard",
                  description: "At-least-once delivery, best-effort ordering.",
                },
                {
                  value: "fifo",
                  label: "FIFO",
                  description: "First-in-first-out delivery, exactly-once processing.",
                },
              ]}
            />
          </FormField>
          <FormField
            label="Name"
            constraintText={
              type === "fifo"
                ? "FIFO queue names must end with .fifo — it is appended automatically."
                : "Up to 80 characters: letters, numbers, hyphens, and underscores."
            }
          >
            <Input
              value={name}
              autoFocus
              placeholder="my-queue"
              onChange={(event) => setName(event.detail.value)}
            />
          </FormField>
          <FormField label="Visibility timeout (seconds)">
            <Input
              value={visibilityTimeout}
              type="number"
              onChange={(event) => setVisibilityTimeout(event.detail.value)}
            />
          </FormField>
          <FormField label="Message retention period (seconds)">
            <Input
              value={retention}
              type="number"
              onChange={(event) => setRetention(event.detail.value)}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
