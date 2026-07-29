import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ListSubscriptionsCommand, SNSClient, UnsubscribeCommand } from "@aws-sdk/client-sns";
import type { Subscription } from "@aws-sdk/client-sns";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { subscriptionStatus, topicNameFromArn } from "./snsFormat";

/** Account-wide subscription list, matching AWS's Subscriptions nav entry. */
export default function SubscriptionsPage() {
  const navigate = useNavigate();
  const client = useAwsClient(SNSClient);
  const { notify } = useNotifications();

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [selected, setSelected] = useState<Subscription[]>([]);

  useBreadcrumbs([
    { text: "Amazon SNS", href: "/sns" },
    { text: "Subscriptions", href: "/sns/subscriptions" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSubscriptions((await client.send(new ListSubscriptionsCommand({}))).Subscriptions ?? []);
      setFailed(false);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFailed(true);
      notify({ type: "error", header: `Couldn't load subscriptions — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const deleteSelected = async () => {
    // A pending subscription has no real ARN yet and cannot be removed.
    const removable = selected.filter(
      (subscription) =>
        subscription.SubscriptionArn && subscription.SubscriptionArn !== "PendingConfirmation",
    );
    if (removable.length === 0) {
      notify({
        type: "warning",
        content: "Pending subscriptions cannot be deleted until they are confirmed.",
      });
      return;
    }
    try {
      await Promise.all(
        removable.map((subscription) =>
          client.send(new UnsubscribeCommand({ SubscriptionArn: subscription.SubscriptionArn })),
        ),
      );
      notify({ type: "success", content: `Deleted ${removable.length} subscription(s).` });
      setSelected([]);
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't delete — ${title}`, content: detail });
    }
  };

  const query = filterText.trim().toLowerCase();
  const matching = subscriptions.filter((subscription) =>
    query === "" ? true : JSON.stringify(subscription).toLowerCase().includes(query),
  );

  return (
    <ContentLayout header={<Header variant="h1">Subscriptions</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading subscriptions"
        items={matching}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={(event) => setSelected(event.detail.selectedItems)}
        trackBy={(subscription) => subscription.SubscriptionArn ?? subscription.Endpoint ?? ""}
        header={
          <Header
            counter={loading ? undefined : `(${subscriptions.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
                <Button disabled={selected.length === 0} onClick={() => void deleteSelected()}>
                  Delete
                </Button>
              </SpaceBetween>
            }
          >
            Subscriptions
          </Header>
        }
        columnDefinitions={[
          {
            id: "arn",
            header: "Subscription ARN",
            cell: (s) => s.SubscriptionArn ?? "—",
            isRowHeader: true,
          },
          { id: "endpoint", header: "Endpoint", cell: (s) => s.Endpoint ?? "—" },
          { id: "protocol", header: "Protocol", cell: (s) => s.Protocol ?? "—" },
          {
            id: "status",
            header: "Status",
            cell: (s) => subscriptionStatus(s.SubscriptionArn),
          },
          {
            id: "topic",
            header: "Topic",
            cell: (s) =>
              s.TopicArn ? (
                <Link
                  href={`/sns/topics/${topicNameFromArn(s.TopicArn)}`}
                  onFollow={(event) => {
                    event.preventDefault();
                    navigate(`/sns/topics/${topicNameFromArn(s.TopicArn ?? "")}`);
                  }}
                >
                  {topicNameFromArn(s.TopicArn)}
                </Link>
              ) : (
                "—"
              ),
          },
        ]}
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder="Search subscriptions"
            filteringAriaLabel="Search subscriptions"
            countText={query ? `${matching.length} matches` : ""}
            onChange={(event) => setFilterText(event.detail.filteringText)}
          />
        }
        empty={
          failed ? (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">Couldn't load subscriptions</Box>
                <Button onClick={() => void load()}>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Box textAlign="center" padding={{ vertical: "l" }}>
              <SpaceBetween size="s">
                <Box variant="strong">No subscriptions</Box>
                <Box variant="p" color="text-body-secondary">
                  Create a subscription from a topic to deliver messages to an endpoint.
                </Box>
              </SpaceBetween>
            </Box>
          )
        }
      />
    </ContentLayout>
  );
}
