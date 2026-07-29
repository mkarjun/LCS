import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  GetFunctionCommand,
  InvocationType,
  InvokeCommand,
  LambdaClient,
  ListAliasesCommand,
  ListVersionsByFunctionCommand,
  LogType,
} from "@aws-sdk/client-lambda";
import type { AliasConfiguration, FunctionConfiguration } from "@aws-sdk/client-lambda";
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { dash, formatLambdaDate } from "./lambdaFormat";

interface InvokeResult {
  statusCode?: number;
  functionError?: string;
  payload: string;
  logs: string;
}

export default function FunctionDetailPage() {
  const { functionName = "" } = useParams();
  const client = useAwsClient(LambdaClient);
  const logsClient = useAwsClient(CloudWatchLogsClient);
  const { notify } = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();

  const [config, setConfig] = useState<FunctionConfiguration | null>(null);
  const [aliases, setAliases] = useState<AliasConfiguration[]>([]);
  const [versions, setVersions] = useState<FunctionConfiguration[]>([]);
  const [loading, setLoading] = useState(true);

  const [payload, setPayload] = useState('{\n  "key": "value"\n}');
  const [invoking, setInvoking] = useState(false);
  const [result, setResult] = useState<InvokeResult | null>(null);

  const [logEvents, setLogEvents] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const activeTab = searchParams.get("tab") ?? "configuration";

  useBreadcrumbs([
    { text: "Lambda", href: "/lambda" },
    { text: "Functions", href: "/lambda" },
    { text: functionName, href: `/lambda/functions/${functionName}` },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.send(new GetFunctionCommand({ FunctionName: functionName }));
      setConfig(response.Configuration ?? null);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load function — ${title}`, content: detail });
      setLoading(false);
      return;
    }
    const [aliasResult, versionResult] = await Promise.allSettled([
      client.send(new ListAliasesCommand({ FunctionName: functionName })),
      client.send(new ListVersionsByFunctionCommand({ FunctionName: functionName })),
    ]);
    setAliases(aliasResult.status === "fulfilled" ? (aliasResult.value.Aliases ?? []) : []);
    setVersions(versionResult.status === "fulfilled" ? (versionResult.value.Versions ?? []) : []);
    setLoading(false);
  }, [client, functionName, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs the function for real and decodes the base64 log tail AWS returns. */
  const invoke = async () => {
    setInvoking(true);
    setResult(null);
    try {
      const response = await client.send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: InvocationType.RequestResponse,
          LogType: LogType.Tail,
          Payload: new TextEncoder().encode(payload),
        }),
      );
      const body = response.Payload
        ? new TextDecoder().decode(response.Payload as Uint8Array)
        : "";
      setResult({
        statusCode: response.StatusCode,
        functionError: response.FunctionError,
        payload: body,
        logs: response.LogResult ? atob(response.LogResult) : "",
      });
      notify({
        type: response.FunctionError ? "warning" : "success",
        content: response.FunctionError
          ? `Function returned an error: ${response.FunctionError}`
          : "Execution succeeded.",
      });
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Invocation failed — ${title}`, content: detail });
    } finally {
      setInvoking(false);
    }
  };

  /** Monitor tab: the log group Lambda creates on first invocation. */
  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    const logGroupName = `/aws/lambda/${functionName}`;
    try {
      const streams = await logsClient.send(
        new DescribeLogStreamsCommand({
          logGroupName,
          orderBy: "LastEventTime",
          descending: true,
          limit: 1,
        }),
      );
      const streamName = streams.logStreams?.[0]?.logStreamName;
      if (!streamName) {
        setLogEvents([]);
        return;
      }
      const events = await logsClient.send(
        new GetLogEventsCommand({ logGroupName, logStreamName: streamName, limit: 200 }),
      );
      setLogEvents((events.events ?? []).map((event) => event.message ?? ""));
    } catch {
      // No log group yet simply means the function has never been invoked.
      setLogEvents([]);
    } finally {
      setLogsLoading(false);
    }
  }, [logsClient, functionName]);

  useEffect(() => {
    if (activeTab === "monitor") {
      void loadLogs();
    }
  }, [activeTab, loadLogs]);

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

  const envVars = Object.entries(config?.Environment?.Variables ?? {}).map(([key, value]) => ({
    key,
    value,
  }));

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" ariaLabel="Refresh" onClick={() => void load()} />
              <Button
                variant="primary"
                loading={invoking}
                onClick={() => {
                  setSearchParams({ tab: "test" });
                  void invoke();
                }}
              >
                Test
              </Button>
            </SpaceBetween>
          }
        >
          {functionName}
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Function overview</Header>}>
          <ColumnLayout columns={4} variant="text-grid">
            {field("Function ARN", dash(config?.FunctionArn))}
            {field("Runtime", dash(config?.Runtime))}
            {field("Handler", dash(config?.Handler))}
            {field("Package type", dash(config?.PackageType))}
            {field("Memory", config?.MemorySize ? `${config.MemorySize} MB` : "—")}
            {field("Timeout", config?.Timeout ? `${config.Timeout} sec` : "—")}
            {field("Code size", config?.CodeSize ? `${config.CodeSize} bytes` : "—")}
            {field("Last modified", formatLambdaDate(config?.LastModified))}
            {field(
              "State",
              config?.State === "Active" ? (
                <StatusIndicator type="success">Active</StatusIndicator>
              ) : (
                <StatusIndicator type="pending">{dash(config?.State)}</StatusIndicator>
              ),
            )}
            {field("Role", dash(config?.Role))}
            {field("Architecture", (config?.Architectures ?? []).join(", ") || "—")}
            {field("Version", dash(config?.Version))}
          </ColumnLayout>
        </Container>

        <Tabs
          activeTabId={activeTab}
          onChange={(event) => setSearchParams({ tab: event.detail.activeTabId })}
          tabs={[
            {
              id: "configuration",
              label: "Configuration",
              content: (
                <SpaceBetween size="l">
                  <Container header={<Header variant="h2">General configuration</Header>}>
                    <ColumnLayout columns={3} variant="text-grid">
                      {field("Description", dash(config?.Description))}
                      {field("Memory", config?.MemorySize ? `${config.MemorySize} MB` : "—")}
                      {field("Timeout", config?.Timeout ? `${config.Timeout} sec` : "—")}
                      {field(
                        "Ephemeral storage",
                        config?.EphemeralStorage?.Size ? `${config.EphemeralStorage.Size} MB` : "—",
                      )}
                      {field("Tracing", dash(config?.TracingConfig?.Mode))}
                      {field("Revision ID", dash(config?.RevisionId))}
                    </ColumnLayout>
                  </Container>
                  <Table
                    variant="container"
                    header={
                      <Header variant="h2" counter={`(${envVars.length})`}>
                        Environment variables
                      </Header>
                    }
                    items={envVars}
                    trackBy={(item) => item.key}
                    columnDefinitions={[
                      { id: "key", header: "Key", cell: (item) => item.key, isRowHeader: true },
                      { id: "value", header: "Value", cell: (item) => item.value ?? "" },
                    ]}
                    empty={
                      <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                        No environment variables.
                      </Box>
                    }
                  />
                </SpaceBetween>
              ),
            },
            {
              id: "test",
              label: "Test",
              content: (
                <SpaceBetween size="l">
                  <Container
                    header={
                      <Header
                        variant="h2"
                        description="Invoke the function with a JSON event and inspect the response."
                        actions={
                          <Button variant="primary" loading={invoking} onClick={() => void invoke()}>
                            Test
                          </Button>
                        }
                      >
                        Test event
                      </Header>
                    }
                  >
                    <FormField label="Event JSON">
                      <Textarea
                        value={payload}
                        rows={10}
                        onChange={(event) => setPayload(event.detail.value)}
                      />
                    </FormField>
                  </Container>

                  {result && (
                    <Container
                      header={
                        <Header
                          variant="h2"
                          description={
                            result.functionError
                              ? `Status ${result.statusCode} · ${result.functionError}`
                              : `Status ${result.statusCode}`
                          }
                        >
                          {result.functionError ? "Execution result: failed" : "Execution result: succeeded"}
                        </Header>
                      }
                    >
                      <SpaceBetween size="m">
                        <SpaceBetween size="xxs">
                          <Box variant="awsui-key-label">Response</Box>
                          <Box variant="code" display="block">
                            <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowX: "auto" }}>
                              {result.payload}
                            </pre>
                          </Box>
                        </SpaceBetween>
                        {result.logs && (
                          <SpaceBetween size="xxs">
                            <Box variant="awsui-key-label">Function logs</Box>
                            <Box variant="code" display="block">
                              <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowX: "auto" }}>
                                {result.logs}
                              </pre>
                            </Box>
                          </SpaceBetween>
                        )}
                      </SpaceBetween>
                    </Container>
                  )}
                </SpaceBetween>
              ),
            },
            {
              id: "monitor",
              label: "Monitor",
              content: (
                <Container
                  header={
                    <Header
                      variant="h2"
                      description={`CloudWatch log group /aws/lambda/${functionName}`}
                      actions={
                        <Button iconName="refresh" ariaLabel="Refresh logs" onClick={() => void loadLogs()} />
                      }
                    >
                      Recent log events
                    </Header>
                  }
                >
                  {logsLoading ? (
                    <Box textAlign="center" padding={{ vertical: "l" }}>
                      <Spinner />
                    </Box>
                  ) : logEvents.length === 0 ? (
                    <Box textAlign="center" padding={{ vertical: "l" }} color="text-body-secondary">
                      No log events. Logs appear after the function is invoked.
                    </Box>
                  ) : (
                    <Box variant="code" display="block">
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowX: "auto" }}>
                        {logEvents.join("")}
                      </pre>
                    </Box>
                  )}
                </Container>
              ),
            },
            {
              id: "aliases",
              label: "Aliases",
              content: (
                <Table
                  variant="container"
                  header={
                    <Header variant="h2" counter={`(${aliases.length})`}>
                      Aliases
                    </Header>
                  }
                  items={aliases}
                  trackBy={(alias) => alias.Name ?? ""}
                  columnDefinitions={[
                    { id: "name", header: "Name", cell: (a) => a.Name ?? "-", isRowHeader: true },
                    { id: "version", header: "Version", cell: (a) => a.FunctionVersion ?? "-" },
                    { id: "description", header: "Description", cell: (a) => a.Description || "—" },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                      No aliases for this function.
                    </Box>
                  }
                />
              ),
            },
            {
              id: "versions",
              label: "Versions",
              content: (
                <Table
                  variant="container"
                  header={
                    <Header variant="h2" counter={`(${versions.length})`}>
                      Versions
                    </Header>
                  }
                  items={versions}
                  trackBy={(version) => version.Version ?? ""}
                  columnDefinitions={[
                    { id: "version", header: "Version", cell: (v) => v.Version ?? "-", isRowHeader: true },
                    { id: "description", header: "Description", cell: (v) => v.Description || "—" },
                    { id: "modified", header: "Last modified", cell: (v) => formatLambdaDate(v.LastModified) },
                    { id: "size", header: "Code size", cell: (v) => (v.CodeSize ? `${v.CodeSize} bytes` : "—") },
                  ]}
                  empty={
                    <Box textAlign="center" padding={{ vertical: "m" }} color="text-body-secondary">
                      No published versions.
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
