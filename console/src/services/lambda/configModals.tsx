import { useEffect, useState } from "react";
import {
  AddPermissionCommand,
  CreateEventSourceMappingCommand,
  LambdaClient,
  PutFunctionConcurrencyCommand,
  PutFunctionEventInvokeConfigCommand,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import type { FunctionConfiguration } from "@aws-sdk/client-lambda";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import Textarea from "@cloudscape-design/components/textarea";
import type { SelectProps } from "@cloudscape-design/components/select";

import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { ConfigModalShell, useConfigSubmit } from "./ConfigModalShell";

/** Props every config edit modal shares. */
interface ConfigModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSaved: () => Promise<void>;
  client: LambdaClient;
  functionName: string;
}

const RUNTIMES = ["nodejs20.x", "nodejs18.x", "python3.12", "python3.11", "java21"];

// ─── General configuration ────────────────────────────────────────────────

export function EditGeneralModal({
  visible,
  onDismiss,
  onSaved,
  client,
  functionName,
  config,
}: ConfigModalProps & { config: FunctionConfiguration | null }) {
  const { error, setError, submitting, submit } = useConfigSubmit();
  const [description, setDescription] = useState("");
  const [memory, setMemory] = useState("128");
  const [timeout, setTimeout] = useState("3");
  const [handler, setHandler] = useState("");
  const [runtime, setRuntime] = useState<SelectProps.Option>({ label: "", value: "" });

  useEffect(() => {
    if (visible) {
      setDescription(config?.Description ?? "");
      setMemory(String(config?.MemorySize ?? 128));
      setTimeout(String(config?.Timeout ?? 3));
      setHandler(config?.Handler ?? "");
      setRuntime({ label: config?.Runtime ?? "", value: config?.Runtime ?? "" });
      setError(null);
    }
  }, [visible, config, setError]);

  const onSubmit = () => {
    const mem = Number.parseInt(memory, 10);
    const to = Number.parseInt(timeout, 10);
    if (!Number.isFinite(mem) || mem < 128) {
      setError("Memory must be at least 128 MB.");
      return;
    }
    if (!Number.isFinite(to) || to < 1) {
      setError("Timeout must be at least 1 second.");
      return;
    }
    void submit(async () => {
      await client.send(
        new UpdateFunctionConfigurationCommand({
          FunctionName: functionName,
          Description: description,
          MemorySize: mem,
          Timeout: to,
          Handler: handler.trim() || undefined,
          Runtime: (runtime.value || undefined) as never,
        }),
      );
      await onSaved();
    }).then((ok) => ok && onDismiss());
  };

  return (
    <ConfigModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Edit basic settings"
      submitLabel="Save"
      onSubmit={onSubmit}
      submitting={submitting}
      error={error}
    >
      <FormField label="Description">
        <Input value={description} onChange={(e) => setDescription(e.detail.value)} />
      </FormField>
      <FormField label="Runtime">
        <Select
          selectedOption={runtime}
          options={RUNTIMES.map((r) => ({ label: r, value: r }))}
          onChange={(e) => setRuntime(e.detail.selectedOption)}
        />
      </FormField>
      <FormField label="Handler">
        <Input value={handler} onChange={(e) => setHandler(e.detail.value)} />
      </FormField>
      <FormField label="Memory (MB)" constraintText="128 MB to 10240 MB.">
        <Input value={memory} type="number" onChange={(e) => setMemory(e.detail.value)} />
      </FormField>
      <FormField label="Timeout (seconds)">
        <Input value={timeout} type="number" onChange={(e) => setTimeout(e.detail.value)} />
      </FormField>
    </ConfigModalShell>
  );
}

// ─── Environment variables ────────────────────────────────────────────────

export function EditEnvVarsModal({
  visible,
  onDismiss,
  onSaved,
  client,
  functionName,
  config,
}: ConfigModalProps & { config: FunctionConfiguration | null }) {
  const { error, setError, submitting, submit } = useConfigSubmit();
  const [vars, setVars] = useState<KeyValuePair[]>([]);

  useEffect(() => {
    if (visible) {
      setVars(
        Object.entries(config?.Environment?.Variables ?? {}).map(([key, value]) => ({
          key,
          value: value ?? "",
        })),
      );
      setError(null);
    }
  }, [visible, config, setError]);

  const onSubmit = () => {
    const entries = vars.filter((v) => v.key.trim() !== "");
    const variables = Object.fromEntries(entries.map((v) => [v.key.trim(), v.value]));
    void submit(async () => {
      // UpdateFunctionConfiguration replaces the whole Environment block, so the full set
      // is sent every time — an empty object clears all variables, matching the AWS console.
      await client.send(
        new UpdateFunctionConfigurationCommand({
          FunctionName: functionName,
          Environment: { Variables: variables },
        }),
      );
      await onSaved();
    }).then((ok) => ok && onDismiss());
  };

  return (
    <ConfigModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Edit environment variables"
      submitLabel="Save"
      onSubmit={onSubmit}
      submitting={submitting}
      error={error}
      size="large"
    >
      <FormField label="Environment variables" description="Key-value pairs available to the function at runtime.">
        <KeyValueEditor
          items={vars}
          onChange={setVars}
          keyLabel="Key"
          valueLabel="Value"
          addLabel="Add environment variable"
          empty="No environment variables."
        />
      </FormField>
    </ConfigModalShell>
  );
}

// ─── Tags ─────────────────────────────────────────────────────────────────

export function EditTagsModal({
  visible,
  onDismiss,
  onSaved,
  client,
  functionArn,
  current,
}: {
  visible: boolean;
  onDismiss: () => void;
  onSaved: () => Promise<void>;
  client: LambdaClient;
  functionArn: string;
  current: { key: string; value: string }[];
}) {
  const { error, setError, submitting, submit } = useConfigSubmit();
  const [tags, setTags] = useState<KeyValuePair[]>([]);

  useEffect(() => {
    if (visible) {
      setTags(current.map((t) => ({ key: t.key, value: t.value })));
      setError(null);
    }
  }, [visible, current, setError]);

  const onSubmit = () => {
    const next = tags.filter((t) => t.key.trim() !== "");
    const nextKeys = new Set(next.map((t) => t.key.trim()));
    // Tags are edited with two calls: set the current set, and remove keys the user dropped.
    const removed = current.map((t) => t.key).filter((key) => !nextKeys.has(key));
    void submit(async () => {
      if (next.length > 0) {
        await client.send(
          new TagResourceCommand({
            Resource: functionArn,
            Tags: Object.fromEntries(next.map((t) => [t.key.trim(), t.value])),
          }),
        );
      }
      if (removed.length > 0) {
        await client.send(new UntagResourceCommand({ Resource: functionArn, TagKeys: removed }));
      }
      await onSaved();
    }).then((ok) => ok && onDismiss());
  };

  return (
    <ConfigModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Manage tags"
      submitLabel="Save"
      onSubmit={onSubmit}
      submitting={submitting}
      error={error}
      size="large"
    >
      <FormField label="Tags">
        <KeyValueEditor
          items={tags}
          onChange={setTags}
          keyLabel="Key"
          valueLabel="Value"
          addLabel="Add new tag"
          empty="No tags."
        />
      </FormField>
    </ConfigModalShell>
  );
}

// ─── Concurrency ──────────────────────────────────────────────────────────

export function EditConcurrencyModal({
  visible,
  onDismiss,
  onSaved,
  client,
  functionName,
  reserved,
}: ConfigModalProps & { reserved: number | null }) {
  const { error, setError, submitting, submit } = useConfigSubmit();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (visible) {
      setValue(reserved === null ? "" : String(reserved));
      setError(null);
    }
  }, [visible, reserved, setError]);

  const onSubmit = () => {
    const trimmed = value.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (trimmed !== "" && (!Number.isFinite(parsed) || parsed < 0)) {
      setError("Reserved concurrency must be a non-negative number, or blank for unreserved.");
      return;
    }
    void submit(async () => {
      // AWS uses PutFunctionConcurrency here; blank = leave unreserved (0 fully throttles).
      await client.send(
        new PutFunctionConcurrencyCommand({
          FunctionName: functionName,
          ReservedConcurrentExecutions: trimmed === "" ? 0 : parsed,
        }),
      );
      await onSaved();
    }).then((ok) => ok && onDismiss());
  };

  return (
    <ConfigModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Edit concurrency"
      submitLabel="Save"
      onSubmit={onSubmit}
      submitting={submitting}
      error={error}
    >
      <FormField
        label="Reserved concurrency"
        description="Guarantees this many concurrent executions. 0 throttles the function entirely."
      >
        <Input value={value} type="number" placeholder="Unreserved" onChange={(e) => setValue(e.detail.value)} />
      </FormField>
    </ConfigModalShell>
  );
}

// ─── Add trigger (event source mapping) ───────────────────────────────────

const ESM_SOURCES: SelectProps.Option[] = [
  { value: "sqs", label: "SQS", description: "arn:aws:sqs:… queue" },
  { value: "dynamodb", label: "DynamoDB", description: "table stream ARN" },
  { value: "kinesis", label: "Kinesis", description: "stream ARN" },
];

export function AddTriggerModal({
  visible,
  onDismiss,
  onSaved,
  client,
  functionName,
}: ConfigModalProps) {
  const { error, setError, submitting, submit } = useConfigSubmit();
  const [source, setSource] = useState<SelectProps.Option>(ESM_SOURCES[0]);
  const [arn, setArn] = useState("");
  const [batchSize, setBatchSize] = useState("10");

  useEffect(() => {
    if (visible) {
      setSource(ESM_SOURCES[0]);
      setArn("");
      setBatchSize("10");
      setError(null);
    }
  }, [visible, setError]);

  const onSubmit = () => {
    if (arn.trim() === "") {
      setError("Enter the event source ARN.");
      return;
    }
    const batch = Number.parseInt(batchSize, 10);
    void submit(async () => {
      await client.send(
        new CreateEventSourceMappingCommand({
          FunctionName: functionName,
          EventSourceArn: arn.trim(),
          BatchSize: Number.isFinite(batch) ? batch : 10,
          // DynamoDB and Kinesis require a starting position; SQS must not have one.
          ...(source.value === "sqs" ? {} : { StartingPosition: "LATEST" }),
        }),
      );
      await onSaved();
    }).then((ok) => ok && onDismiss());
  };

  return (
    <ConfigModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Add trigger"
      submitLabel="Add"
      onSubmit={onSubmit}
      submitting={submitting}
      error={error}
    >
      <FormField
        label="Source"
        description="LCS wires event-source triggers (SQS, DynamoDB streams, Kinesis). S3 / SNS / EventBridge triggers are configured on those services."
      >
        <Select
          selectedOption={source}
          options={ESM_SOURCES}
          onChange={(e) => setSource(e.detail.selectedOption)}
        />
      </FormField>
      <FormField label="Event source ARN">
        <Input value={arn} placeholder="arn:aws:sqs:us-east-1:000000000000:my-queue" onChange={(e) => setArn(e.detail.value)} />
      </FormField>
      <FormField label="Batch size">
        <Input value={batchSize} type="number" onChange={(e) => setBatchSize(e.detail.value)} />
      </FormField>
    </ConfigModalShell>
  );
}

// ─── Destinations (event invoke config) ───────────────────────────────────

export function EditDestinationsModal({
  visible,
  onDismiss,
  onSaved,
  client,
  functionName,
  onSuccessArn,
  onFailureArn,
}: ConfigModalProps & { onSuccessArn: string; onFailureArn: string }) {
  const { error, setError, submitting, submit } = useConfigSubmit();
  const [success, setSuccess] = useState("");
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (visible) {
      setSuccess(onSuccessArn);
      setFailure(onFailureArn);
      setError(null);
    }
  }, [visible, onSuccessArn, onFailureArn, setError]);

  const onSubmit = () => {
    void submit(async () => {
      await client.send(
        new PutFunctionEventInvokeConfigCommand({
          FunctionName: functionName,
          DestinationConfig: {
            OnSuccess: success.trim() ? { Destination: success.trim() } : undefined,
            OnFailure: failure.trim() ? { Destination: failure.trim() } : undefined,
          },
        }),
      );
      await onSaved();
    }).then((ok) => ok && onDismiss());
  };

  return (
    <ConfigModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Edit destinations"
      submitLabel="Save"
      onSubmit={onSubmit}
      submitting={submitting}
      error={error}
    >
      <FormField label="On success destination" description="SQS, SNS, Lambda, or EventBridge ARN for successful async invocations.">
        <Input value={success} placeholder="arn:aws:sqs:…" onChange={(e) => setSuccess(e.detail.value)} />
      </FormField>
      <FormField label="On failure destination">
        <Input value={failure} placeholder="arn:aws:sns:…" onChange={(e) => setFailure(e.detail.value)} />
      </FormField>
    </ConfigModalShell>
  );
}

// ─── Add resource-based permission ────────────────────────────────────────

export function AddPermissionModal({
  visible,
  onDismiss,
  onSaved,
  client,
  functionName,
}: ConfigModalProps) {
  const { error, setError, submitting, submit } = useConfigSubmit();
  const [statementId, setStatementId] = useState("");
  const [principal, setPrincipal] = useState("");
  const [action, setAction] = useState("lambda:InvokeFunction");
  const [sourceArn, setSourceArn] = useState("");

  useEffect(() => {
    if (visible) {
      setStatementId("");
      setPrincipal("");
      setAction("lambda:InvokeFunction");
      setSourceArn("");
      setError(null);
    }
  }, [visible, setError]);

  const onSubmit = () => {
    if (statementId.trim() === "" || principal.trim() === "") {
      setError("Statement ID and principal are required.");
      return;
    }
    void submit(async () => {
      await client.send(
        new AddPermissionCommand({
          FunctionName: functionName,
          StatementId: statementId.trim(),
          Principal: principal.trim(),
          Action: action.trim(),
          ...(sourceArn.trim() ? { SourceArn: sourceArn.trim() } : {}),
        }),
      );
      await onSaved();
    }).then((ok) => ok && onDismiss());
  };

  return (
    <ConfigModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Add permissions"
      submitLabel="Save"
      onSubmit={onSubmit}
      submitting={submitting}
      error={error}
    >
      <FormField label="Statement ID">
        <Input value={statementId} placeholder="s3invoke" onChange={(e) => setStatementId(e.detail.value)} />
      </FormField>
      <FormField label="Principal" description="An AWS service (s3.amazonaws.com) or account ID.">
        <Input value={principal} placeholder="s3.amazonaws.com" onChange={(e) => setPrincipal(e.detail.value)} />
      </FormField>
      <FormField label="Action">
        <Input value={action} onChange={(e) => setAction(e.detail.value)} />
      </FormField>
      <FormField label="Source ARN" description="Optional. Restricts the permission to a specific source resource.">
        <Textarea value={sourceArn} rows={2} onChange={(e) => setSourceArn(e.detail.value)} />
      </FormField>
    </ConfigModalShell>
  );
}
