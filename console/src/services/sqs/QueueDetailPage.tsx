import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ListQueueTagsCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { Message } from "@aws-sdk/client-sqs";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { formatKb, formatSeconds, formatSqsTimestamp, queueType } from "./sqsFormat";

export default function QueueDetailPage() {
  const { queueName = "" } = useParams();
  const client = useAwsClient(SQSClient);
  const { notify } = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();

  const [queueUrl, setQueueUrl] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<{ key: string; value: string }[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [body, setBody] = useState('{\n  "example": "message"\n}');
  const [sending, setSending] = useState(false);

  const activeTab = searchParams.get("tab") ?? "details";

  useBreadcrumbs([
    { text: "Amazon SQS", href: "/sqs" },
    { text: "Queues", href: "/sqs" },
    { text: queueName, href: `/sqs/queues/${queueName}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The console addresses queues by name, but every other call needs the URL.
      const url = (await client.send(new GetQueueUrlCommand({ QueueName: queueName }))).QueueUrl;
      setQueueUrl(url ?? null);
      if (!url) {
        return;
      }
      const response = await client.send(
        new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["All"] }),
      );
      setAttributes(response.Attributes ?? {});

      try {
        const tagResponse = await client.send(new ListQueueTagsCommand({ QueueUrl: url }));
        setTags(
          Object.entries(tagResponse.Tags ?? {}).map(([key, value]) => ({ key, value })),
        );
      } catch {
        setTags([]);
      }
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load queue — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, queueName, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Polling makes messages temporarily invisible rather than removing them, matching the
   * AWS console's "Poll for messages". Deleting is a separate, explicit action.
   */
  const poll = async () => {
    if (!queueUrl) {
      return;
    }
    setPolling(true);
    try {
      const response = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
          VisibilityTimeout: 1,
          MessageAttributeNames: ["All"],
          AttributeNames: ["All"],
        }),
      );
      setMessages(response.Messages ?? []);
      notify({
        type: "success",
        content: `Polled ${(response.Messages ?? []).length} message(s).`,
      });
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't poll — ${title}`, content: detail });
    } finally {
      setPolling(false);
    }
  };

  const send = async () => {
    if (!queueUrl) {
      return;
    }
    setSending(true);
    try {
      await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: body,
          // FIFO queues reject a send without a group id.
          ...(queueName.endsWith(".fifo")
            ? {
                MessageGroupId: "console",
                MessageDeduplicationId: String(Date.now()),
              }
            : {}),
        }),
      );
      notify({ type: "success", content: "Message sent." });
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't send message — ${title}`, content: detail });
    } finally {
      setSending(false);
    }
  };

  const deleteMessage = async (message: Message) => {
    if (!queueUrl || !message.ReceiptHandle) {
      return;
    }
    try {
      await client.send(
        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }),
      );
      setMessages((current) => current.filter((item) => item.MessageId !== message.MessageId));
      notify({ type: "success", content: "Message deleted." });
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't delete message — ${title}`, content: detail });
    }
  };

  const purge = async () => {
    if (!queueUrl) {
      return;
    }
    try {
      await client.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
      setMessages([]);
      notify({ type: "success", content: "Queue purged." });
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't purge queue — ${title}`, content: detail });
    }
  };

  if (loading) {
    return (
      <Box textAlign="center" padding={{ vertical: "xxl" }}>
        <Spinner size="large" />
      </Box>
    );
  }

  const field = (label: string, content: React.ReactNode) => (
    <SpaceBetween size="xxs">
      <Box variant="awsui-key-label">{label}</Box>
      <Box>{content}</Box>
    </SpaceBetween>
  );

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
              <Button onClick={() => void purge()}>Purge</Button>
              <Button
                variant="primary"
                onClick={() => setSearchParams({ tab: "send-receive" })}
              >
                Send and receive messages
              </Button>
            </SpaceBetween>
          }
        >
          {queueName}
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Details</Header>}>
          <ColumnLayout columns={4} variant="text-grid">
            {field("Name", queueName)}
            {field("Type", queueType(queueName))}
            {field("ARN", attributes.QueueArn ?? "—")}
            {field("Created", formatSqsTimestamp(attributes.CreatedTimestamp))}
            {field("Messages available", attributes.ApproximateNumberOfMessages ?? "—")}
            {field("Messages in flight", attributes.ApproximateNumberOfMessagesNotVisible ?? "—")}
            {field("Messages delayed", attributes.ApproximateNumberOfMessagesDelayed ?? "—")}
            {field("Visibility timeout", formatSeconds(attributes.VisibilityTimeout))}
            {field("Message retention period", formatSeconds(attributes.MessageRetentionPeriod))}
            {field("Delivery delay", formatSeconds(attributes.DelaySeconds))}
            {field("Maximum message size", formatKb(attributes.MaximumMessageSize))}
            {field("Last modified", formatSqsTimestamp(attributes.LastModifiedTimestamp))}
          </ColumnLayout>
        </Container>

        <Tabs
          activeTabId={activeTab}
          onChange={(event) => setSearchParams({ tab: event.detail.activeTabId })}
          tabs={[
            {
              id: "details",
              label: "Dead-letter queue",
              content: (
                <Container header={<Header variant="h2">Dead-letter queue</Header>}>
                  {attributes.RedrivePolicy ? (
                    <Box variant="code" display="block">
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                        {attributes.RedrivePolicy}
                      </pre>
                    </Box>
                  ) : (
                    <Box color="text-body-secondary">
                      No dead-letter queue configured for this queue.
                    </Box>
                  )}
                </Container>
              ),
            },
            {
              id: "send-receive",
              label: "Send and receive messages",
              content: (
                <SpaceBetween size="l">
                  <Container
                    header={
                      <Header
                        variant="h2"
                        actions={
                          <Button variant="primary" loading={sending} onClick={() => void send()}>
                            Send message
                          </Button>
                        }
                      >
                        Send message
                      </Header>
                    }
                  >
                    <FormField label="Message body">
                      <Textarea
                        value={body}
                        rows={8}
                        onChange={(event) => setBody(event.detail.value)}
                      />
                    </FormField>
                  </Container>

                  <Table
                    variant="container"
                    items={messages}
                    trackBy={(message) => message.MessageId ?? ""}
                    wrapLines
                    header={
                      <Header
                        variant="h2"
                        counter={`(${messages.length})`}
                        description="Polling makes messages briefly invisible; it does not remove them. Use Delete to remove one."
                        actions={
                          <Button loading={polling} onClick={() => void poll()}>
                            Poll for messages
                          </Button>
                        }
                      >
                        Messages
                      </Header>
                    }
                    columnDefinitions={[
                      {
                        id: "id",
                        header: "Message ID",
                        cell: (message) => message.MessageId ?? "—",
                        isRowHeader: true,
                      },
                      {
                        id: "sent",
                        header: "Sent",
                        cell: (message) =>
                          formatSqsTimestamp(
                            message.Attributes?.SentTimestamp
                              ? String(Math.floor(Number(message.Attributes.SentTimestamp) / 1000))
                              : undefined,
                          ),
                      },
                      {
                        id: "body",
                        header: "Body",
                        cell: (message) => (
                          <Box variant="code" fontSize="body-s">
                            {message.Body}
                          </Box>
                        ),
                      },
                      {
                        id: "actions",
                        header: "",
                        cell: (message) => (
                          <Button variant="inline-link" onClick={() => void deleteMessage(message)}>
                            Delete
                          </Button>
                        ),
                      },
                    ]}
                    empty={
                      <Box textAlign="center" padding={{ vertical: "l" }} color="text-body-secondary">
                        No messages polled yet. Choose "Poll for messages" to receive.
                      </Box>
                    }
                  />
                </SpaceBetween>
              ),
            },
            {
              id: "tags",
              label: "Tags",
              content: (
                <Table
                  variant="container"
                  header={
                    <Header variant="h2" counter={`(${tags.length})`}>
                      Tags
                    </Header>
                  }
                  items={tags}
                  trackBy={(tag) => tag.key}
                  columnDefinitions={[
                    { id: "key", header: "Key", cell: (tag) => tag.key, isRowHeader: true },
                    { id: "value", header: "Value", cell: (tag) => tag.value },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                      No tags associated with this queue.
                    </Box>
                  }
                />
              ),
            },
          ]}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}
