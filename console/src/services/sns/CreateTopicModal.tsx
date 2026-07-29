import { useEffect, useState } from "react";
import { CreateTopicCommand, SNSClient } from "@aws-sdk/client-sns";
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

export function CreateTopicModal({
  visible,
  onDismiss,
  onCreated,
}: {
  visible: boolean;
  onDismiss: () => void;
  onCreated: () => Promise<void>;
}) {
  const client = useAwsClient(SNSClient);
  const { notify } = useNotifications();

  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [type, setType] = useState("standard");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setName("");
      setDisplayName("");
      setType("standard");
      setFormError(null);
    }
  }, [visible]);

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setFormError("Topic name is required.");
      return;
    }
    // SNS requires FIFO topic names to end in .fifo, so append it rather than fail late.
    const finalName = type === "fifo" && !trimmed.endsWith(".fifo") ? `${trimmed}.fifo` : trimmed;

    setSubmitting(true);
    setFormError(null);
    try {
      await client.send(
        new CreateTopicCommand({
          Name: finalName,
          Attributes: {
            ...(displayName.trim() ? { DisplayName: displayName.trim() } : {}),
            ...(type === "fifo" ? { FifoTopic: "true" } : {}),
          },
        }),
      );
      notify({ type: "success", content: `Topic "${finalName}" created.` });
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
      header="Create topic"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Create topic
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
                  description: "Best-effort ordering, at-least-once delivery.",
                },
                {
                  value: "fifo",
                  label: "FIFO",
                  description: "Strict ordering, exactly-once delivery.",
                },
              ]}
            />
          </FormField>
          <FormField
            label="Name"
            constraintText={
              type === "fifo"
                ? "FIFO topic names must end with .fifo. It is appended automatically."
                : "Up to 256 characters: letters, numbers, hyphens, and underscores."
            }
          >
            <Input
              value={name}
              autoFocus
              placeholder="my-topic"
              onChange={(event) => setName(event.detail.value)}
            />
          </FormField>
          <FormField
            label="Display name - optional"
            description="Used as the sender name for email subscriptions."
          >
            <Input value={displayName} onChange={(event) => setDisplayName(event.detail.value)} />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
