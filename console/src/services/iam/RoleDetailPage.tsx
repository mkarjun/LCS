import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  GetRoleCommand,
  ListAttachedRolePoliciesCommand,
  ListRolePoliciesCommand,
} from "@aws-sdk/client-iam";
import type { AttachedPolicy, Role } from "@aws-sdk/client-iam";
import Box from "@cloudscape-design/components/box";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";

import { describeAwsError } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { dash, formatIamDate, formatPolicyDocument, trustedEntities, useIamClient } from "./useIamClient";

export default function RoleDetailPage() {
  const { roleName = "" } = useParams();
  const client = useIamClient();
  const { notify } = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();

  const [role, setRole] = useState<Role | null>(null);
  const [attached, setAttached] = useState<AttachedPolicy[]>([]);
  const [inline, setInline] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const activeTab = searchParams.get("tab") ?? "permissions";

  useBreadcrumbs([
    { text: "IAM", href: "/iam" },
    { text: "Roles", href: "/iam/roles" },
    { text: roleName, href: `/iam/roles/${roleName}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(new GetRoleCommand({ RoleName: roleName }));
      setRole(response.Role ?? null);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load role — ${title}`, content: detail });
      setLoading(false);
      return;
    }

    const [attachedPolicies, inlinePolicies] = await Promise.allSettled([
      client.send(new ListAttachedRolePoliciesCommand({ RoleName: roleName })),
      client.send(new ListRolePoliciesCommand({ RoleName: roleName })),
    ]);
    setAttached(
      attachedPolicies.status === "fulfilled"
        ? (attachedPolicies.value.AttachedPolicies ?? [])
        : [],
    );
    setInline(inlinePolicies.status === "fulfilled" ? (inlinePolicies.value.PolicyNames ?? []) : []);
    setLoading(false);
  }, [client, roleName, notify]);

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
    <ContentLayout header={<Header variant="h1">{roleName}</Header>}>
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Summary</Header>}>
          <ColumnLayout columns={3} variant="text-grid">
            {field("ARN", dash(role?.Arn))}
            {field("Path", dash(role?.Path))}
            {field("Creation time", formatIamDate(role?.CreateDate))}
            {field("Role ID", dash(role?.RoleId))}
            {field(
              "Maximum session duration",
              role?.MaxSessionDuration ? `${role.MaxSessionDuration / 3600} hours` : "—",
            )}
            {field("Description", dash(role?.Description))}
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
                    ]}
                    empty={
                      <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                        No managed policies attached to this role.
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
                        No inline policies on this role.
                      </Box>
                    }
                  />
                </SpaceBetween>
              ),
            },
            {
              id: "trust-relationships",
              label: "Trust relationships",
              content: (
                <Container
                  header={
                    <Header
                      variant="h2"
                      description="Entities that can assume this role under the conditions in the trust policy."
                    >
                      Trusted entities
                    </Header>
                  }
                >
                  <SpaceBetween size="m">
                    {field("Trusted entities", trustedEntities(role?.AssumeRolePolicyDocument))}
                    <Box variant="code" display="block">
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowX: "auto" }}>
                        {formatPolicyDocument(role?.AssumeRolePolicyDocument)}
                      </pre>
                    </Box>
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
                    <Header variant="h2" counter={`(${(role?.Tags ?? []).length})`}>
                      Tags
                    </Header>
                  }
                  items={role?.Tags ?? []}
                  trackBy={(tag) => tag.Key ?? ""}
                  columnDefinitions={[
                    { id: "key", header: "Key", cell: (tag) => tag.Key ?? "-", isRowHeader: true },
                    { id: "value", header: "Value", cell: (tag) => tag.Value ?? "-" },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                      No tags associated with this role.
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
