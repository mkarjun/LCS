import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  DeleteFunctionCommand,
  GetFunctionCommand,
  GetFunctionConcurrencyCommand,
  InvocationType,
  InvokeCommand,
  LambdaClient,
  ListAliasesCommand,
  ListTagsCommand,
  ListVersionsByFunctionCommand,
  LogType,
  PutFunctionConcurrencyCommand,
} from "@aws-sdk/client-lambda";
import type { AliasConfiguration, FunctionConfiguration } from "@aws-sdk/client-lambda";
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import Textarea from "@cloudscape-design/components/textarea";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { useNotifications } from "@shell/NotificationContext";
import { formatLambdaDate } from "./lambdaFormat";
import { CodeEditor } from "./CodeEditor";
import { FunctionOverview } from "./FunctionOverview";
import { ConfigurationTab } from "./ConfigurationTab";

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [config, setConfig] = useState<FunctionConfiguration | null>(null);
  const [codeLocation, setCodeLocation] = useState<string | null>(null);
  const [packageType, setPackageType] = useState<string | undefined>(undefined);
  const [reservedConcurrency, setReservedConcurrency] = useState<number | null>(null);
  const [tags, setTags] = useState<{ key: string; value: string }[]>([]);
  const [aliases, setAliases] = useState<AliasConfiguration[]>([]);
  const [versions, setVersions] = useState<FunctionConfiguration[]>([]);
  const [loading, setLoading] = useState(true);

  const [payload, setPayload] = useState('{\n  "key": "value"\n}');
  const [invoking, setInvoking] = useState(false);
  const [result, setResult] = useState<InvokeResult | null>(null);

  const [logEvents, setLogEvents] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Which confirm dialog is open, if any.
  const [pending, setPending] = useState<"throttle" | "delete" | null>(null);
  const [acting, setActing] = useState(false);

  // AWS's default tab is Code.
  const activeTab = searchParams.get("tab") ?? "code";

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
      setCodeLocation(response.Code?.Location ?? null);
      setPackageType(response.Configuration?.PackageType);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Couldn't load function — ${title}`, content: detail });
      setLoading(false);
      return;
    }
    const [concurrency, tagResult, aliasResult, versionResult] = await Promise.allSettled([
      client.send(new GetFunctionConcurrencyCommand({ FunctionName: functionName })),
      client.send(new ListTagsCommand({ Resource: functionName })),
      client.send(new ListAliasesCommand({ FunctionName: functionName })),
      client.send(new ListVersionsByFunctionCommand({ FunctionName: functionName })),
    ]);
    setReservedConcurrency(
      concurrency.status === "fulfilled" && concurrency.value.ReservedConcurrentExecutions !== undefined
        ? concurrency.value.ReservedConcurrentExecutions
        : null,
    );
    setTags(
      tagResult.status === "fulfilled"
        ? Object.entries(tagResult.value.Tags ?? {}).map(([key, value]) => ({ key, value }))
        : [],
    );
    setAliases(aliasResult.status === "fulfilled" ? (aliasResult.value.Aliases ?? []) : []);
    setVersions(versionResult.status === "fulfilled" ? (versionResult.value.Versions ?? []) : []);
    setLoading(false);
  }, [client, functionName, notify]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const copyArn = () => {
    if (config?.FunctionArn) {
      void navigator.clipboard.writeText(config.FunctionArn);
      notify({ type: "success", content: "Function ARN copied." });
    }
  };

  const runPending = async () => {
    setActing(true);
    try {
      if (pending === "throttle") {
        // AWS's "Throttle" sets reserved concurrency to 0, which stops all invocations.
        await client.send(
          new PutFunctionConcurrencyCommand({
            FunctionName: functionName,
            ReservedConcurrentExecutions: 0,
          }),
        );
        notify({ type: "success", content: `Function "${functionName}" throttled (reserved concurrency 0).` });
        setPending(null);
        await load();
      } else if (pending === "delete") {
        await client.send(new DeleteFunctionCommand({ FunctionName: functionName }));
        notify({ type: "success", content: `Function "${functionName}" deleted.` });
        navigate("/lambda");
      }
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Action failed — ${title}`, content: detail });
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <Box textAlign="center" padding={{ vertical: "xxl" }}>
        <Spinner size="large" />
      </Box>
    );
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setPending("throttle")}>Throttle</Button>
              <Button iconName="copy" onClick={copyArn}>
                Copy ARN
              </Button>
              <ButtonDropdown
                items={[
                  { id: "test", text: "Test" },
                  { id: "delete", text: "Delete function" },
                ]}
                onItemClick={(event) => {
                  if (event.detail.id === "delete") {
                    setPending("delete");
                  } else if (event.detail.id === "test") {
                    setSearchParams({ tab: "test" });
                  }
                }}
              >
                Actions
              </ButtonDropdown>
            </SpaceBetween>
          }
        >
          {functionName}
        </Header>
      }
    >
      <SpaceBetween size="l">
        <FunctionOverview config={config} />

        <Tabs
          activeTabId={activeTab}
          onChange={(event) => setSearchParams({ tab: event.detail.activeTabId })}
          tabs={[
            {
              id: "code",
              label: "Code",
              content: (
                <CodeEditor
                  client={client}
                  functionName={functionName}
                  config={config}
                  codeLocation={codeLocation}
                  packageType={packageType}
                  onDeployed={load}
                />
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
                          {result.functionError
                            ? "Execution result: failed"
                            : "Execution result: succeeded"}
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
                <SpaceBetween size="l">
                  <Alert type="info">
                    CloudWatch metric graphs are not available — LCS does not produce Lambda
                    metrics. Recent log events from the function's log group are shown instead.
                  </Alert>
                  <Container
                    header={
                      <Header
                        variant="h2"
                        description={`CloudWatch log group /aws/lambda/${functionName}`}
                        actions={
                          <Button
                            iconName="refresh"
                            ariaLabel="Refresh logs"
                            onClick={() => void loadLogs()}
                          />
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
                </SpaceBetween>
              ),
            },
            {
              id: "configuration",
              label: "Configuration",
              content: (
                <ConfigurationTab
                  config={config}
                  reservedConcurrency={reservedConcurrency}
                  tags={tags}
                />
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

      <Modal
        visible={pending !== null}
        onDismiss={() => setPending(null)}
        header={pending === "delete" ? "Delete function" : "Throttle function"}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setPending(null)} disabled={acting}>
                Cancel
              </Button>
              <Button variant="primary" loading={acting} onClick={() => void runPending()}>
                {pending === "delete" ? "Delete" : "Throttle"}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        {pending === "delete" ? (
          <Alert type="warning">
            Delete function "{functionName}"? This cannot be undone. Aliases and versions are
            deleted with it.
          </Alert>
        ) : (
          <Alert type="warning">
            Throttle "{functionName}"? This sets reserved concurrency to 0, stopping all
            invocations until you raise it again.
          </Alert>
        )}
      </Modal>
    </ContentLayout>
  );
}
