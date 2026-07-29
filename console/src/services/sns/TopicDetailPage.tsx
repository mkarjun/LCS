import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
  ListTagsForResourceCommand,
  ListTopicsCommand,
  PublishCommand,
  SNSClient,
  UnsubscribeCommand,
} from "@aws-sdk/client-sns";
import type { Subscription } from "@aws-sdk/client-sns";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { CreateSubscriptionModal } from "./CreateSubscriptionModal";
import { dash, subscriptionStatus, topicNameFromArn, topicType } from "./snsFormat";

export default function TopicDetailPage() {
  const { topicName = "" } = useParams();
  const client = useAwsClient(SNSClient);
  const { notify } = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();

  const [topicArn, setTopicArn] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [tags, setTags] = useState<{ key: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState('{\n  "example": "event"\n}');
  const [publishing, setPublishing] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  const activeTab = searchParams.get("tab") ?? "subscriptions";

  useBreadcrumbs([
    { text: "Amazon SNS", href: "/sns" },
    { text: "Topics", href: "/sns" },
    { text: topicName, href: `/sns/topics/${topicName}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // SNS has no GetTopicByName, so the ARN is resolved by matching the name.
      const arns = (await client.send(new ListTopicsCommand({}))).Topics ?? [];
      const arn =
        arns.map((topic) => topic.TopicArn ?? "").find((a) => topicNameFromArn(a) === topicName) ??
        null;
      setTopicArn(arn);
      if (!arn) {
        return;
      }

      const response = await client.send(new GetTopicAttributesCommand({ TopicArn: arn }));
      setAttributes(response.Attributes ?? {});

      const [subsResult, tagResult] = await Promise.allSettled([
        client.send(new ListSubscriptionsByTopicCommand({ TopicArn: arn })),
        client.send(new ListTagsForResourceCommand({ ResourceArn: arn })),
      ]);
      setSubscriptions(
        subsResult.status === "fulfilled" ? (subsResult.value.Subscriptions ?? []) : [],
      );
      setTags(
        tagResult.status === "fulfilled"
          ? (tagResult.value.Tags ?? []).map((tag) => ({
              key: tag.Key ?? "",
              value: tag.Value ?? "",
            }))
          : [],
      );
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load topic — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, topicName, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const publish = async () => {
    if (!topicArn) {
      return;
    }
    setPublishing(true);
    try {
      await client.send(
        new PublishCommand({
          TopicArn: topicArn,
          Message: message,
          ...(subject.trim() ? { Subject: subject.trim() } : {}),
          // FIFO topics require a group id, as with FIFO queues.
          ...(topicName.endsWith(".fifo")
            ? { MessageGroupId: "console", MessageDeduplicationId: String(Date.now()) }
            : {}),
        }),
      );
      notify({ type: "success", content: "Message published to the topic." });
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't publish — ${title}`, content: detail });
    } finally {
      setPublishing(false);
    }
  };

  const unsubscribe = async (subscription: Subscription) => {
    const arn = subscription.SubscriptionArn;
    if (!arn || arn === "PendingConfirmation") {
      notify({
        type: "warning",
        content: "A pending subscription cannot be removed until it is confirmed.",
      });
      return;
    }
    try {
      await client.send(new UnsubscribeCommand({ SubscriptionArn: arn }));
      notify({ type: "success", content: "Subscription deleted." });
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't unsubscribe — ${title}`, content: detail });
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
              <Button variant="primary" onClick={() => setSearchParams({ tab: "publish" })}>
                Publish message
              </Button>
            </SpaceBetween>
          }
        >
          {topicName}
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Details</Header>}>
          <ColumnLayout columns={4} variant="text-grid">
            {field("Name", topicName)}
            {field("Type", topicType(topicArn ?? topicName))}
            {field("ARN", dash(topicArn ?? undefined))}
            {field("Display name", dash(attributes.DisplayName))}
            {field("Owner", dash(attributes.Owner))}
            {field("Subscriptions confirmed", dash(attributes.SubscriptionsConfirmed))}
            {field("Subscriptions pending", dash(attributes.SubscriptionsPending))}
            {field("Subscriptions deleted", dash(attributes.SubscriptionsDeleted))}
          </ColumnLayout>
        </Container>

        <Tabs
          activeTabId={activeTab}
          onChange={(event) => setSearchParams({ tab: event.detail.activeTabId })}
          tabs={[
            {
              id: "subscriptions",
              label: "Subscriptions",
              content: (
                <Table
                  variant="container"
                  items={subscriptions}
                  trackBy={(subscription) => subscription.SubscriptionArn ?? subscription.Endpoint ?? ""}
                  header={
                    <Header
                      variant="h2"
                      counter={`(${subscriptions.length})`}
                      actions={
                        <Button variant="primary" onClick={() => setSubscribeOpen(true)}>
                          Create subscription
                        </Button>
                      }
                    >
                      Subscriptions
                    </Header>
                  }
                  columnDefinitions={[
                    {
                      id: "endpoint",
                      header: "Endpoint",
                      cell: (s) => s.Endpoint ?? "—",
                      isRowHeader: true,
                    },
                    { id: "protocol", header: "Protocol", cell: (s) => s.Protocol ?? "—" },
                    {
                      id: "status",
                      header: "Status",
                      cell: (s) => subscriptionStatus(s.SubscriptionArn),
                    },
                    { id: "arn", header: "Subscription ARN", cell: (s) => s.SubscriptionArn ?? "—" },
                    {
                      id: "actions",
                      header: "",
                      cell: (s) => (
                        <Button variant="inline-link" onClick={() => void unsubscribe(s)}>
                          Delete
                        </Button>
                      ),
                    },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "l" }}>
                      <SpaceBetween size="s">
                        <Box variant="strong">No subscriptions</Box>
                        <Box variant="p" color="text-body-secondary">
                          Create a subscription to deliver messages to an endpoint.
                        </Box>
                        <Button onClick={() => setSubscribeOpen(true)}>Create subscription</Button>
                      </SpaceBetween>
                    </Box>
                  }
                />
              ),
            },
            {
              id: "publish",
              label: "Publish message",
              content: (
                <Container
                  header={
                    <Header
                      variant="h2"
                      description="The message is delivered to every confirmed subscription on this topic."
                      actions={
                        <Button variant="primary" loading={publishing} onClick={() => void publish()}>
                          Publish message
                        </Button>
                      }
                    >
                      Publish message
                    </Header>
                  }
                >
                  <SpaceBetween size="l">
                    <FormField label="Subject - optional">
                      <Input
                        value={subject}
                        placeholder="Order created"
                        onChange={(event) => setSubject(event.detail.value)}
                      />
                    </FormField>
                    <FormField label="Message body">
                      <Textarea
                        value={message}
                        rows={10}
                        onChange={(event) => setMessage(event.detail.value)}
                      />
                    </FormField>
                  </SpaceBetween>
                </Container>
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
                      No tags associated with this topic.
                    </Box>
                  }
                />
              ),
            },
          ]}
        />
      </SpaceBetween>

      <CreateSubscriptionModal
        visible={subscribeOpen}
        topicArn={topicArn}
        onDismiss={() => setSubscribeOpen(false)}
        onCreated={async () => {
          setSubscribeOpen(false);
          await load();
        }}
      />
    </ContentLayout>
  );
}
