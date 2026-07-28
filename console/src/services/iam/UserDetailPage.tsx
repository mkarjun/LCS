import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  GetUserCommand,
  ListAccessKeysCommand,
  ListAttachedUserPoliciesCommand,
  ListGroupsForUserCommand,
  ListUserPoliciesCommand,
} from "@aws-sdk/client-iam";
import type {
  AccessKeyMetadata,
  AttachedPolicy,
  Group,
  User,
} from "@aws-sdk/client-iam";
import Box from "@cloudscape-design/components/box";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";

import { describeAwsError } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { dash, formatIamDate, useIamClient } from "./useIamClient";

export default function UserDetailPage() {
  const { userName = "" } = useParams();
  const client = useIamClient();
  const { notify } = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();

  const [user, setUser] = useState<User | null>(null);
  const [accessKeys, setAccessKeys] = useState<AccessKeyMetadata[]>([]);
  const [attached, setAttached] = useState<AttachedPolicy[]>([]);
  const [inline, setInline] = useState<string[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  const activeTab = searchParams.get("tab") ?? "permissions";

  useBreadcrumbs([
    { text: "IAM", href: "/iam" },
    { text: "Users", href: "/iam" },
    { text: userName, href: `/iam/users/${userName}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(new GetUserCommand({ UserName: userName }));
      setUser(response.User ?? null);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load user — ${title}`, content: detail });
      setLoading(false);
      return;
    }

    // Sub-resources are best-effort: a failure in one must not blank the page.
    const [keys, attachedPolicies, inlinePolicies, groupList] = await Promise.allSettled([
      client.send(new ListAccessKeysCommand({ UserName: userName })),
      client.send(new ListAttachedUserPoliciesCommand({ UserName: userName })),
      client.send(new ListUserPoliciesCommand({ UserName: userName })),
      client.send(new ListGroupsForUserCommand({ UserName: userName })),
    ]);

    setAccessKeys(keys.status === "fulfilled" ? (keys.value.AccessKeyMetadata ?? []) : []);
    setAttached(
      attachedPolicies.status === "fulfilled"
        ? (attachedPolicies.value.AttachedPolicies ?? [])
        : [],
    );
    setInline(inlinePolicies.status === "fulfilled" ? (inlinePolicies.value.PolicyNames ?? []) : []);
    setGroups(groupList.status === "fulfilled" ? (groupList.value.Groups ?? []) : []);
    setLoading(false);
  }, [client, userName, notify]);

  useEffect(() => {
    void load();
  }, [load]);

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
    <ContentLayout header={<Header variant="h1">{userName}</Header>}>
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Summary</Header>}>
          <ColumnLayout columns={3} variant="text-grid">
            {field("ARN", dash(user?.Arn))}
            {field("Path", dash(user?.Path))}
            {field("Creation time", formatIamDate(user?.CreateDate))}
            {field("User ID", dash(user?.UserId))}
            {field("Last console sign-in", formatIamDate(user?.PasswordLastUsed))}
            {field("Access keys", String(accessKeys.length))}
          </ColumnLayout>
        </Container>

        <Tabs
          activeTabId={activeTab}
          onChange={(event) => setSearchParams({ tab: event.detail.activeTabId })}
          tabs={[
            {
              id: "permissions",
              label: "Permissions",
              content: (
                <SpaceBetween size="l">
                  <Table
                    variant="container"
                    header={
                      <Header variant="h2" counter={`(${attached.length})`}>
                        Permissions policies
                      </Header>
                    }
                    items={attached}
                    trackBy={(policy) => policy.PolicyArn ?? ""}
                    columnDefinitions={[
                      {
                        id: "name",
                        header: "Policy name",
                        cell: (policy) => policy.PolicyName ?? "-",
                        isRowHeader: true,
                      },
                      { id: "arn", header: "ARN", cell: (policy) => policy.PolicyArn ?? "-" },
                      { id: "type", header: "Type", cell: () => "Customer managed" },
                    ]}
                    empty={
                      <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                        No managed policies attached to this user.
                      </Box>
                    }
                  />
                  <Table
                    variant="container"
                    header={
                      <Header variant="h2" counter={`(${inline.length})`}>
                        Inline policies
                      </Header>
                    }
                    items={inline.map((name) => ({ name }))}
                    trackBy={(item) => item.name}
                    columnDefinitions={[
                      { id: "name", header: "Policy name", cell: (item) => item.name, isRowHeader: true },
                    ]}
                    empty={
                      <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                        No inline policies on this user.
                      </Box>
                    }
                  />
                </SpaceBetween>
              ),
            },
            {
              id: "groups",
              label: "Groups",
              content: (
                <Table
                  variant="container"
                  header={
                    <Header variant="h2" counter={`(${groups.length})`}>
                      Groups
                    </Header>
                  }
                  items={groups}
                  trackBy={(group) => group.GroupName ?? ""}
                  columnDefinitions={[
                    {
                      id: "name",
                      header: "Group name",
                      cell: (group) => group.GroupName ?? "-",
                      isRowHeader: true,
                    },
                    { id: "path", header: "Path", cell: (group) => dash(group.Path) },
                    { id: "arn", header: "ARN", cell: (group) => group.Arn ?? "-" },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                      This user is not a member of any groups.
                    </Box>
                  }
                />
              ),
            },
            {
              id: "security-credentials",
              label: "Security credentials",
              content: (
                <Table
                  variant="container"
                  header={
                    <Header
                      variant="h2"
                      counter={`(${accessKeys.length})`}
                      description="Use access keys to make programmatic calls to AWS from the CLI or SDKs."
                    >
                      Access keys
                    </Header>
                  }
                  items={accessKeys}
                  trackBy={(key) => key.AccessKeyId ?? ""}
                  columnDefinitions={[
                    {
                      id: "id",
                      header: "Access key ID",
                      cell: (key) => key.AccessKeyId ?? "-",
                      isRowHeader: true,
                    },
                    {
                      id: "status",
                      header: "Status",
                      cell: (key) =>
                        key.Status === "Active" ? (
                          <StatusIndicator type="success">Active</StatusIndicator>
                        ) : (
                          <StatusIndicator type="stopped">Inactive</StatusIndicator>
                        ),
                    },
                    { id: "created", header: "Created", cell: (key) => formatIamDate(key.CreateDate) },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                      No access keys for this user.
                    </Box>
                  }
                />
              ),
            },
            {
              id: "tags",
              label: "Tags",
              content: (
                <Table
                  variant="container"
                  header={
                    <Header variant="h2" counter={`(${(user?.Tags ?? []).length})`}>
                      Tags
                    </Header>
                  }
                  items={user?.Tags ?? []}
                  trackBy={(tag) => tag.Key ?? ""}
                  columnDefinitions={[
                    { id: "key", header: "Key", cell: (tag) => tag.Key ?? "-", isRowHeader: true },
                    { id: "value", header: "Value", cell: (tag) => tag.Value ?? "-" },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                      No tags associated with this user.
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
