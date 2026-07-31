import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  DeleteEventSourceMappingCommand,
  GetFunctionEventInvokeConfigCommand,
  GetPolicyCommand,
  LambdaClient,
  ListEventSourceMappingsCommand,
  RemovePermissionCommand,
} from "@aws-sdk/client-lambda";
import type { EventSourceMappingConfiguration, FunctionConfiguration } from "@aws-sdk/client-lambda";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";

import { describeAwsError } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";
import { dash } from "./lambdaFormat";
import {
  AddPermissionModal,
  AddTriggerModal,
  EditConcurrencyModal,
  EditDestinationsModal,
  EditEnvVarsModal,
  EditGeneralModal,
  EditTagsModal,
} from "./configModals";

interface ConfigSection {
  id: string;
  label: string;
  render?: () => ReactNode;
  reason?: string;
}

interface PolicyStatement {
  Sid?: string;
  Principal?: unknown;
  Action?: string | string[];
}

function field(label: string, content: ReactNode) {
  return (
    <div>
      <Box variant="awsui-key-label">{label}</Box>
      <Box>{content}</Box>
    </div>
  );
}

/** AWS renders a policy Principal as "s3.amazonaws.com" or an account ARN. */
function principalText(principal: unknown): string {
  if (typeof principal === "string") {
    return principal;
  }
  if (principal && typeof principal === "object") {
    return Object.values(principal as Record<string, string | string[]>)
      .flat()
      .join(", ");
  }
  return "—";
}

export function ConfigurationTab({
  config,
  reservedConcurrency,
  tags,
  client,
  functionName,
  functionArn,
  onChanged,
  initialSection,
}: {
  config: FunctionConfiguration | null;
  reservedConcurrency: number | null;
  tags: { key: string; value: string }[];
  client: LambdaClient;
  functionName: string;
  functionArn: string;
  onChanged: () => Promise<void>;
  /** Section to preselect, e.g. when arriving from the overview's Add trigger button. */
  initialSection?: string | null;
}) {
  const { notify } = useNotifications();
  const [selected, setSelected] = useState(initialSection || "general");
  const [editing, setEditing] = useState<string | null>(null);

  // Follow the section requested by the overview buttons (via a search param).
  useEffect(() => {
    if (initialSection) {
      setSelected(initialSection);
    }
  }, [initialSection]);

  // Data owned by this tab (not needed elsewhere): triggers, destinations, permissions.
  const [triggers, setTriggers] = useState<EventSourceMappingConfiguration[]>([]);
  const [statements, setStatements] = useState<PolicyStatement[]>([]);
  const [onSuccess, setOnSuccess] = useState("");
  const [onFailure, setOnFailure] = useState("");

  const loadExtras = useCallback(async () => {
    const [esm, policy, invoke] = await Promise.allSettled([
      client.send(new ListEventSourceMappingsCommand({ FunctionName: functionName })),
      client.send(new GetPolicyCommand({ FunctionName: functionName })),
      client.send(new GetFunctionEventInvokeConfigCommand({ FunctionName: functionName })),
    ]);
    setTriggers(esm.status === "fulfilled" ? (esm.value.EventSourceMappings ?? []) : []);
    if (policy.status === "fulfilled" && policy.value.Policy) {
      try {
        const parsed = JSON.parse(policy.value.Policy) as { Statement?: PolicyStatement[] };
        setStatements(parsed.Statement ?? []);
      } catch {
        setStatements([]);
      }
    } else {
      // GetPolicy throws ResourceNotFoundException when no resource policy exists.
      setStatements([]);
    }
    if (invoke.status === "fulfilled") {
      setOnSuccess(invoke.value.DestinationConfig?.OnSuccess?.Destination ?? "");
      setOnFailure(invoke.value.DestinationConfig?.OnFailure?.Destination ?? "");
    } else {
      setOnSuccess("");
      setOnFailure("");
    }
  }, [client, functionName]);

  useEffect(() => {
    void loadExtras();
  }, [loadExtras]);

  const refreshAll = useCallback(async () => {
    await Promise.all([onChanged(), loadExtras()]);
  }, [onChanged, loadExtras]);

  const deleteTrigger = async (uuid: string | undefined) => {
    if (!uuid) {
      return;
    }
    try {
      await client.send(new DeleteEventSourceMappingCommand({ UUID: uuid }));
      notify({ type: "success", content: "Trigger removed." });
      await loadExtras();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't remove trigger — ${title}`, content: detail });
    }
  };

  const removeStatement = async (sid: string | undefined) => {
    if (!sid) {
      return;
    }
    try {
      await client.send(new RemovePermissionCommand({ FunctionName: functionName, StatementId: sid }));
      notify({ type: "success", content: `Permission "${sid}" removed.` });
      await loadExtras();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't remove permission — ${title}`, content: detail });
    }
  };

  const editHeader = (title: string, editId: string, label = "Edit") => (
    <Header variant="h3" actions={<Button onClick={() => setEditing(editId)}>{label}</Button>}>
      {title}
    </Header>
  );

  const generalSection = () => (
    <Container header={editHeader("General configuration", "general")}>
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

  const triggersSection = () => (
    <Table
      variant="container"
      header={
        <Header
          variant="h3"
          counter={`(${triggers.length})`}
          actions={<Button onClick={() => setEditing("add-trigger")}>Add trigger</Button>}
        >
          Triggers
        </Header>
      }
      items={triggers}
      trackBy={(t) => t.UUID ?? ""}
      columnDefinitions={[
        { id: "source", header: "Source ARN", cell: (t) => t.EventSourceArn ?? "—", isRowHeader: true },
        { id: "state", header: "State", cell: (t) => t.State ?? "—" },
        { id: "batch", header: "Batch size", cell: (t) => String(t.BatchSize ?? "—") },
        {
          id: "remove",
          header: "",
          cell: (t) => (
            <Button variant="inline-link" onClick={() => void deleteTrigger(t.UUID)}>
              Delete
            </Button>
          ),
        },
      ]}
      empty={
        <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
          No triggers. Add an SQS, DynamoDB stream, or Kinesis event source.
        </Box>
      }
    />
  );

  const permissionsSection = () => (
    <SpaceBetween size="l">
      <Container header={<Header variant="h3">Execution role</Header>}>
        <ColumnLayout columns={1} variant="text-grid">
          {field(
            "Role ARN",
            config?.Role ? (
              <Link
                external
                href={`/iam/roles/${config.Role.split("/").pop()}`}
                onFollow={(e) => e.preventDefault()}
              >
                {config.Role}
              </Link>
            ) : (
              "—"
            ),
          )}
        </ColumnLayout>
      </Container>
      <Table
        variant="container"
        header={
          <Header
            variant="h3"
            counter={`(${statements.length})`}
            actions={<Button onClick={() => setEditing("add-permission")}>Add permissions</Button>}
          >
            Resource-based policy statements
          </Header>
        }
        items={statements}
        trackBy={(s) => s.Sid ?? Math.random().toString()}
        columnDefinitions={[
          { id: "sid", header: "Statement ID", cell: (s) => s.Sid ?? "—", isRowHeader: true },
          { id: "principal", header: "Principal", cell: (s) => principalText(s.Principal) },
          {
            id: "action",
            header: "Action",
            cell: (s) => (Array.isArray(s.Action) ? s.Action.join(", ") : (s.Action ?? "—")),
          },
          {
            id: "remove",
            header: "",
            cell: (s) => (
              <Button variant="inline-link" onClick={() => void removeStatement(s.Sid)}>
                Delete
              </Button>
            ),
          },
        ]}
        empty={
          <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
            No resource-based policy. Add a permission to let another service invoke this function.
          </Box>
        }
      />
    </SpaceBetween>
  );

  const destinationsSection = () => (
    <Container header={editHeader("Destinations", "destinations")}>
      <ColumnLayout columns={2} variant="text-grid">
        {field("On success", dash(onSuccess))}
        {field("On failure", dash(onFailure))}
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
          <Header
            variant="h3"
            counter={`(${items.length})`}
            actions={<Button onClick={() => setEditing("env")}>Edit</Button>}
          >
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
        <Header
          variant="h3"
          counter={`(${tags.length})`}
          actions={<Button onClick={() => setEditing("tags")}>Manage tags</Button>}
        >
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
    <Container header={editHeader("Concurrency and recursion detection", "concurrency")}>
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

  const sections: ConfigSection[] = [
    { id: "general", label: "General configuration", render: generalSection },
    { id: "triggers", label: "Triggers", render: triggersSection },
    { id: "permissions", label: "Permissions", render: permissionsSection },
    { id: "destinations", label: "Destinations", render: destinationsSection },
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

  const active = sections.find((section) => section.id === selected && section.render);
  const close = () => setEditing(null);

  return (
    <>
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
                  <Box
                    variant={isActive ? "strong" : "span"}
                    color={greyed ? "text-status-inactive" : isActive ? "text-status-info" : "inherit"}
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

      <EditGeneralModal
        visible={editing === "general"}
        onDismiss={close}
        onSaved={refreshAll}
        client={client}
        functionName={functionName}
        config={config}
      />
      <EditEnvVarsModal
        visible={editing === "env"}
        onDismiss={close}
        onSaved={refreshAll}
        client={client}
        functionName={functionName}
        config={config}
      />
      <EditTagsModal
        visible={editing === "tags"}
        onDismiss={close}
        onSaved={refreshAll}
        client={client}
        functionArn={functionArn}
        current={tags}
      />
      <EditConcurrencyModal
        visible={editing === "concurrency"}
        onDismiss={close}
        onSaved={refreshAll}
        client={client}
        functionName={functionName}
        reserved={reservedConcurrency}
      />
      <AddTriggerModal
        visible={editing === "add-trigger"}
        onDismiss={close}
        onSaved={refreshAll}
        client={client}
        functionName={functionName}
      />
      <EditDestinationsModal
        visible={editing === "destinations"}
        onDismiss={close}
        onSaved={refreshAll}
        client={client}
        functionName={functionName}
        onSuccessArn={onSuccess}
        onFailureArn={onFailure}
      />
      <AddPermissionModal
        visible={editing === "add-permission"}
        onDismiss={close}
        onSaved={refreshAll}
        client={client}
        functionName={functionName}
      />
    </>
  );
}
