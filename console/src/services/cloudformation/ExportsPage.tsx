import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CloudFormationClient, ListExportsCommand } from "@aws-sdk/client-cloudformation";
import type { Export } from "@aws-sdk/client-cloudformation";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { stackNameFromId } from "./cfnFormat";

/**
 * Exports — the values stacks publish for Fn::ImportValue.
 *
 * AWS's page has a "Stacks that import this export" drill-down driven by ListImports,
 * which is not implemented here, so the table stops at the exporting stack.
 */
export default function ExportsPage() {
  const navigate = useNavigate();
  const client = useAwsClient(CloudFormationClient);
  const { notify } = useNotifications();

  const [exports, setExports] = useState<Export[]>([]);
  const [loading, setLoading] = useState(true);

  useBreadcrumbs([
    { text: "CloudFormation", href: "/cloudformation" },
    { text: "Exports", href: "/cloudformation/exports" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(new ListExportsCommand({}));
      setExports(response.Exports ?? []);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load exports — ${title}`, content: detail });
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ContentLayout header={<Header variant="h1">Exports</Header>}>
      <Table
        variant="container"
        loading={loading}
        loadingText="Loading exports"
        items={exports}
        trackBy={(item) => item.Name ?? ""}
        header={
          <Header
            counter={loading ? undefined : `(${exports.length})`}
            actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />}
          >
            Exports
          </Header>
        }
        columnDefinitions={[
          {
            id: "name",
            header: "Export name",
            isRowHeader: true,
            cell: (item) => item.Name ?? "—",
          },
          { id: "value", header: "Export value", cell: (item) => item.Value ?? "—" },
          {
            id: "stack",
            header: "Stack",
            cell: (item) => {
              const name = stackNameFromId(item.ExportingStackId);
              return name === "" ? (
                "—"
              ) : (
                <Link
                  href={`/cloudformation/stacks/${name}`}
                  onFollow={(event) => {
                    event.preventDefault();
                    navigate(`/cloudformation/stacks/${name}`);
                  }}
                >
                  {name}
                </Link>
              );
            },
          },
        ]}
        empty={
          <Box textAlign="center" padding={{ vertical: "l" }}>
            <SpaceBetween size="s">
              <Box variant="strong">No exports</Box>
              <Box variant="p" color="text-body-secondary">
                A stack output with an Export name appears here and can be imported by other
                stacks.
              </Box>
            </SpaceBetween>
          </Box>
        }
      />
    </ContentLayout>
  );
}
