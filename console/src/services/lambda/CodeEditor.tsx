import { useCallback, useEffect, useRef, useState } from "react";
import { LambdaClient, UpdateFunctionCodeCommand } from "@aws-sdk/client-lambda";
import type { FunctionConfiguration } from "@aws-sdk/client-lambda";
import Alert from "@cloudscape-design/components/alert";
import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";

import { describeAwsError } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";
import { dash, formatLambdaDate } from "./lambdaFormat";
import { buildZip, unzip } from "./lambdaZip";
import type { ZipEntry } from "./lambdaZip";

/**
 * The AWS Lambda "Code" tab — its default tab and, until now, the biggest gap in the
 * console.
 *
 * AWS embeds a Cloud9/VS Code editor over the deployment package. That editor is a large
 * bundled application and cannot be reproduced from a CDN under the artifact CSP, so this
 * is a lighter editor with the same loop: the package is downloaded from GetFunction's
 * Code.Location, unzipped, shown in a file list beside a text editor, and re-uploaded
 * through UpdateFunctionCode on Deploy. That is the exact round-trip AWS performs, so
 * "edit here, invoke, see the change" works.
 *
 * Image-packaged functions have no editable source; container functions get a notice
 * instead of an editor, as AWS does.
 */
export function CodeEditor({
  client,
  functionName,
  config,
  codeLocation,
  packageType,
  onDeployed,
}: {
  client: LambdaClient;
  functionName: string;
  config: FunctionConfiguration | null;
  codeLocation: string | null;
  packageType: string | undefined;
  onDeployed: () => Promise<void>;
}) {
  const { notify } = useNotifications();
  const [files, setFiles] = useState<ZipEntry[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Track the last loaded package so a reload after Deploy does not wipe unsaved edits
  // the user made while a deploy was in flight.
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!codeLocation) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      // Code.Location is same-origin (served by LCS / proxied by Vite), so a plain fetch
      // works and no SigV4 is needed on it.
      const response = await fetch(codeLocation);
      if (!response.ok) {
        throw new Error(`Package download failed (HTTP ${response.status}).`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const entries = await unzip(bytes);
      setFiles(entries);
      setActiveFile(
        entries.find((entry) => /^index\.|handler|lambda_function/i.test(entry.name))?.name ??
          entries[0]?.name ??
          null,
      );
      setDirty(false);
      loadedFor.current = codeLocation;
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [codeLocation]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateActive = (text: string) => {
    setFiles((current) =>
      current.map((file) => (file.name === activeFile ? { ...file, text } : file)),
    );
    setDirty(true);
  };

  const deploy = async () => {
    if (files.some((file) => file.isBinary)) {
      notify({
        type: "error",
        content: "This package contains binary files the browser editor cannot repackage. Deploy is disabled.",
      });
      return;
    }
    setDeploying(true);
    try {
      const zip = buildZip(files.map((file) => ({ name: file.name, contents: file.text })));
      await client.send(
        new UpdateFunctionCodeCommand({ FunctionName: functionName, ZipFile: zip }),
      );
      notify({ type: "success", content: `Deployed new code for "${functionName}".` });
      setDirty(false);
      await onDeployed();
      await load();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      notify({ type: "error", header: `Deploy failed — ${title}`, content: detail });
    } finally {
      setDeploying(false);
    }
  };

  if (packageType === "Image") {
    return (
      <Container header={<Header variant="h2">Image</Header>}>
        <Alert type="info" header="Code editing is not available for container images">
          This function deploys a container image. Update the image in your container
          registry and point the function at the new tag.
        </Alert>
      </Container>
    );
  }

  const current = files.find((file) => file.name === activeFile);
  const hasBinary = files.some((file) => file.isBinary);

  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header
            variant="h2"
            description="Edit the deployment package in the browser. Deploy re-uploads it, exactly as the AWS console does."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Reload package" onClick={() => void load()} />
                <Button
                  variant="primary"
                  loading={deploying}
                  disabled={!dirty || hasBinary || loading}
                  onClick={() => void deploy()}
                >
                  Deploy
                </Button>
              </SpaceBetween>
            }
          >
            Code source
          </Header>
        }
      >
        {loading ? (
          <Box textAlign="center" padding={{ vertical: "xl" }}>
            <Spinner size="large" />
          </Box>
        ) : loadError !== null ? (
          <Alert
            type="error"
            header="Couldn't load the deployment package"
            action={<Button onClick={() => void load()}>Retry</Button>}
          >
            {loadError}
          </Alert>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "220px 1fr",
              gap: 0,
              minHeight: 420,
            }}
          >
            <div style={{ borderRight: "1px solid rgba(128,128,128,0.3)", paddingRight: 8 }}>
              <Box variant="awsui-key-label" padding={{ bottom: "xs" }}>
                Explorer
              </Box>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {files.map((file) => (
                  // A plain clickable row rather than a nav component — the file list is
                  // flat and this keeps keyboard focus on the editor. Box themes the colour.
                  <div
                    key={file.name}
                    onClick={() => setActiveFile(file.name)}
                    style={{ cursor: "pointer" }}
                  >
                    <Box
                      variant={file.name === activeFile ? "strong" : "span"}
                      color={file.name === activeFile ? "text-status-info" : "inherit"}
                    >
                      {file.name}
                    </Box>
                    {file.isBinary && (
                      <>
                        {" "}
                        <Badge color="grey">binary</Badge>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ paddingLeft: 12 }}>
              {current === undefined ? (
                <Box color="text-body-secondary">No files in this package.</Box>
              ) : current.isBinary ? (
                <Alert type="info">
                  {current.name} is a binary file and cannot be edited here.
                </Alert>
              ) : (
                // color:inherit / background:transparent make the editor follow the
                // Cloudscape theme (light or dark) instead of a hardcoded palette.
                <textarea
                  value={current.text}
                  onChange={(event) => updateActive(event.target.value)}
                  spellCheck={false}
                  style={{
                    width: "100%",
                    minHeight: 400,
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
                    fontSize: 13,
                    lineHeight: 1.5,
                    tabSize: 2,
                    border: "1px solid rgba(128,128,128,0.4)",
                    borderRadius: 8,
                    padding: 12,
                    background: "transparent",
                    color: "inherit",
                    resize: "vertical",
                  }}
                />
              )}
            </div>
          </div>
        )}
        {hasBinary && !loading && loadError === null && (
          <Box padding={{ top: "s" }} color="text-status-inactive" fontSize="body-s">
            Deploy is disabled: this package has binary files the browser editor cannot repackage.
          </Box>
        )}
      </Container>

      <Container
        header={
          <Header
            variant="h2"
            description="Basic settings for the deployment package and runtime."
          >
            Runtime settings
          </Header>
        }
      >
        <ColumnLayout columns={3} variant="text-grid">
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Runtime</Box>
            <Box>{dash(config?.Runtime)}</Box>
          </SpaceBetween>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Handler</Box>
            <Box>{dash(config?.Handler)}</Box>
          </SpaceBetween>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Architecture</Box>
            <Box>{(config?.Architectures ?? []).join(", ") || "—"}</Box>
          </SpaceBetween>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Package size</Box>
            <Box>{config?.CodeSize ? `${config.CodeSize} bytes` : "—"}</Box>
          </SpaceBetween>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">SHA256 hash</Box>
            <Box>{dash(config?.CodeSha256)}</Box>
          </SpaceBetween>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Last modified</Box>
            <Box>{formatLambdaDate(config?.LastModified)}</Box>
          </SpaceBetween>
        </ColumnLayout>
      </Container>
    </SpaceBetween>
  );
}
