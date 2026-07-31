import { useState } from "react";
import type { ReactNode } from "react";
import type { FunctionConfiguration } from "@aws-sdk/client-lambda";
import Box from "@cloudscape-design/components/box";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Table from "@cloudscape-design/components/table";

import { dash } from "./lambdaFormat";

/**
 * The Lambda function "Configuration" tab.
 *
 * AWS puts a sub-navigation rail on the left with ~15 entries and a detail panel on the
 * right. The rail here matches AWS's order and labels; entries LCS can populate from real
 * data are active, the rest are greyed with a reason — the same convention the service nav
 * uses, so the rail keeps AWS's shape without pretending to back an empty section.
 *
 * Colours come from Cloudscape's `<Box color>` (theme-aware) rather than hardcoded values,
 * so text is legible in both light and dark mode.
 */

interface ConfigSection {
  id: string;
  label: string;
  /** Present → real section. Absent → greyed, with `reason` explaining why. */
  render?: () => ReactNode;
  reason?: string;
}

function field(label: string, content: ReactNode) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <Box>{content}</Box>
    </div>
  );
}

export function ConfigurationTab({
  config,
  reservedConcurrency,
  tags,
}: {
  config: FunctionConfiguration | null;
  reservedConcurrency: number | null;
  tags: { key: string; value: string }[];
}) {
  const generalSection = () => (
    <Container header={<Header variant="h3">General configuration</Header>}>
      <ColumnLayout columns={3} variant="text-grid">
        {field("Description", dash(config?.Description))}
        {field("Memory", config?.MemorySize ? `${config.MemorySize} MB` : "—")}
        {field("Timeout", config?.Timeout ? `${config.Timeout} sec` : "—")}
        {field(
          "Ephemeral storage",
          config?.EphemeralStorage?.Size ? `${config.EphemeralStorage.Size} MB` : "—",
        )}
        {field("SnapStart", dash(config?.SnapStart?.ApplyOn))}
        {field("Tracing", dash(config?.TracingConfig?.Mode))}
      </ColumnLayout>
    </Container>
  );

  const permissionsSection = () => (
    <Container header={<Header variant="h3">Execution role</Header>}>
      <ColumnLayout columns={1} variant="text-grid">
        {field("Role ARN", dash(config?.Role))}
      </ColumnLayout>
    </Container>
  );

  const environmentSection = () => {
    const items = Object.entries(config?.Environment?.Variables ?? {}).map(([key, value]) => ({
      key,
      value: value ?? "",
    }));
    return (
      <Table
        variant="container"
        header={
          <Header variant="h3" counter={`(${items.length})`}>
            Environment variables
          </Header>
        }
        items={items}
        trackBy={(item) => item.key}
        columnDefinitions={[
          { id: "key", header: "Key", cell: (item) => item.key, isRowHeader: true },
          { id: "value", header: "Value", cell: (item) => item.value },
        ]}
        empty={
          <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
            No environment variables associated with this function.
          </Box>
        }
      />
    );
  };

  const tagsSection = () => (
    <Table
      variant="container"
      header={
        <Header variant="h3" counter={`(${tags.length})`}>
          Tags
        </Header>
      }
      items={tags}
      trackBy={(item) => item.key}
      columnDefinitions={[
        { id: "key", header: "Key", cell: (item) => item.key, isRowHeader: true },
        { id: "value", header: "Value", cell: (item) => item.value },
      ]}
      empty={
        <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
          No tags.
        </Box>
      }
    />
  );

  const concurrencySection = () => (
    <Container header={<Header variant="h3">Concurrency and recursion detection</Header>}>
      <ColumnLayout columns={2} variant="text-grid">
        {field(
          "Reserved concurrency",
          reservedConcurrency === null
            ? "Use unreserved account concurrency"
            : String(reservedConcurrency),
        )}
        {field(
          "Throttle",
          reservedConcurrency === 0 ? "Throttled (reserved concurrency 0)" : "Not throttled",
        )}
      </ColumnLayout>
    </Container>
  );

  // AWS's rail order and labels. Greyed entries carry a reason.
  const sections: ConfigSection[] = [
    { id: "general", label: "General configuration", render: generalSection },
    { id: "triggers", label: "Triggers", reason: "No console trigger flow yet" },
    { id: "permissions", label: "Permissions", render: permissionsSection },
    { id: "destinations", label: "Destinations", reason: "No console destination flow yet" },
    { id: "url", label: "Function URL", reason: "No function-URL UI yet" },
    { id: "environment", label: "Environment variables", render: environmentSection },
    { id: "tags", label: "Tags", render: tagsSection },
    { id: "vpc", label: "VPC", reason: "Functions do not attach to a VPC in LCS" },
    { id: "rds", label: "RDS databases", reason: "No Lambda-RDS connection UI yet" },
    { id: "monitoring", label: "Monitoring and operations tools", reason: "No metrics backend" },
    {
      id: "concurrency",
      label: "Concurrency and recursion detection",
      render: concurrencySection,
    },
    { id: "async", label: "Asynchronous invocation", reason: "No event-invoke config UI yet" },
    { id: "codesigning", label: "Code signing", reason: "No signing config UI yet" },
    { id: "filesystems", label: "File systems", reason: "No EFS in LCS" },
    { id: "statemachines", label: "State machines", reason: "No Step Functions link UI yet" },
  ];

  const [selected, setSelected] = useState("general");
  const active = sections.find((section) => section.id === selected && section.render);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>
      <Box>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sections.map((section) => {
            const greyed = section.render === undefined;
            const isActive = section.id === selected && !greyed;
            return (
              <div
                key={section.id}
                title={greyed ? `Not available in LCS — ${section.reason}` : undefined}
                onClick={() => {
                  if (!greyed) {
                    setSelected(section.id);
                  }
                }}
                style={{ cursor: greyed ? "not-allowed" : "pointer" }}
              >
                {/* Box themes the colour per light/dark; greyed → inactive, active → info. */}
                <Box
                  variant={isActive ? "strong" : "span"}
                  color={
                    greyed ? "text-status-inactive" : isActive ? "text-status-info" : "inherit"
                  }
                >
                  {section.label}
                </Box>
              </div>
            );
          })}
        </div>
      </Box>
      <div>{active?.render?.()}</div>
    </div>
  );
}
