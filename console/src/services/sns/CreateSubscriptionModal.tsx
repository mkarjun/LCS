import { useEffect, useState } from "react";
import { SNSClient, SubscribeCommand } from "@aws-sdk/client-sns";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { SelectProps } from "@cloudscape-design/components/select";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";

/** Protocols the emulator can actually deliver to. */
const PROTOCOLS: SelectProps.Option[] = [
  { label: "Amazon SQS", value: "sqs", description: "Deliver to an SQS queue ARN" },
  { label: "AWS Lambda", value: "lambda", description: "Invoke a Lambda function ARN" },
  { label: "HTTP", value: "http", description: "POST to an HTTP endpoint" },
  { label: "HTTPS", value: "https", description: "POST to an HTTPS endpoint" },
  { label: "Email", value: "email", description: "Send to an email address" },
];

const PLACEHOLDERS: Record<string, string> = {
  sqs: "arn:aws:sqs:us-east-1:000000000000:my-queue",
  lambda: "arn:aws:lambda:us-east-1:000000000000:function:my-function",
  http: "http://example.com/hook",
  https: "https://example.com/hook",
  email: "ops@example.com",
};

export function CreateSubscriptionModal({
  visible,
  topicArn,
  onDismiss,
  onCreated,
}: {
  visible: boolean;
  topicArn: string | null;
  onDismiss: () => void;
  onCreated: () => Promise<void>;
}) {
  const client = useAwsClient(SNSClient);
  const { notify } = useNotifications();

  const [protocol, setProtocol] = useState<SelectProps.Option>(PROTOCOLS[0]);
  const [endpoint, setEndpoint] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setProtocol(PROTOCOLS[0]);
      setEndpoint("");
      setFormError(null);
    }
  }, [visible]);

  const submit = async () => {
    if (!topicArn) {
      setFormError("Topic ARN could not be resolved.");
      return;
    }
    if (endpoint.trim() === "") {
      setFormError("Endpoint is required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await client.send(
        new SubscribeCommand({
          TopicArn: topicArn,
          Protocol: protocol.value,
          Endpoint: endpoint.trim(),
        }),
      );
      notify({ type: "success", content: "Subscription created." });
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
      header="Create subscription"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Create subscription
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <FormField label="Protocol">
            <Select
              selectedOption={protocol}
              options={PROTOCOLS}
              onChange={(event) => setProtocol(event.detail.selectedOption)}
            />
          </FormField>
          <FormField
            label="Endpoint"
            description="Email and HTTP subscriptions stay pending until the endpoint confirms."
          >
            <Input
              value={endpoint}
              autoFocus
              placeholder={PLACEHOLDERS[protocol.value ?? "sqs"]}
              onChange={(event) => setEndpoint(event.detail.value)}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
