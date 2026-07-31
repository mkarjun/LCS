import { useState } from "react";
import type { FunctionConfiguration } from "@aws-sdk/client-lambda";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { useNotifications } from "@shell/NotificationContext";
import { dash, formatLambdaDate } from "./lambdaFormat";

/**
 * The Lambda "Function overview" panel: the Diagram/Template toggle on the left, function
 * metadata on the right.
 *
 * Add trigger / Add destination are shown but inert. Wiring a trigger from the console is
 * a multi-service flow (event source mappings, S3/SNS/EventBridge notification config)
 * with no single console surface in LCS yet; showing the buttons greyed keeps the AWS
 * shape while being honest that the flow is not built — the same rule the nav uses.
 */
export function FunctionOverview({ config }: { config: FunctionConfiguration | null }) {
  const { notify } = useNotifications();
  const [view, setView] = useState("diagram");

  const copyArn = () => {
    if (config?.FunctionArn) {
      void navigator.clipboard.writeText(config.FunctionArn);
      notify({ type: "success", content: "Function ARN copied." });
    }
  };

  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button disabled iconName="external">
                Export to Infrastructure Composer
              </Button>
              <Button disabled iconAlign="right" iconName="caret-down-filled">
                Download
              </Button>
            </SpaceBetween>
          }
        >
          Function overview
        </Header>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
        <SpaceBetween size="m">
          <SegmentedControl
            selectedId={view}
            onChange={(event) => setView(event.detail.selectedId)}
            options={[
              { id: "diagram", text: "Diagram" },
              { id: "template", text: "Template" },
            ]}
          />
          {view === "diagram" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", alignItems: "center", gap: 12 }}>
              <div>
                <Button disabled iconName="add-plus">
                  Add trigger
                </Button>
              </div>
              <div
                style={{
                  border: "1px solid var(--awsui-color-border-divider-default, #e9ebed)",
                  borderRadius: 12,
                  padding: 16,
                  textAlign: "center",
                }}
              >
                <Box variant="strong">{dash(config?.FunctionName)}</Box>
                <Box fontSize="body-s" color="text-body-secondary">
                  Layers ({(config?.Layers ?? []).length})
                </Box>
              </div>
              <div style={{ textAlign: "right" }}>
                <Button disabled iconName="add-plus">
                  Add destination
                </Button>
              </div>
            </div>
          ) : (
            <Box variant="code" display="block">
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowX: "auto" }}>
                {templateYaml(config)}
              </pre>
            </Box>
          )}
        </SpaceBetween>

        <SpaceBetween size="m">
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Function ARN</Box>
            <SpaceBetween direction="horizontal" size="xs">
              <Box fontSize="body-s">{dash(config?.FunctionArn)}</Box>
              {config?.FunctionArn && (
                <Button variant="inline-icon" iconName="copy" ariaLabel="Copy ARN" onClick={copyArn} />
              )}
            </SpaceBetween>
          </SpaceBetween>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Description</Box>
            <Box>{dash(config?.Description)}</Box>
          </SpaceBetween>
          <SpaceBetween size="xxs">
            <Box variant="awsui-key-label">Last modified</Box>
            <Box>{formatLambdaDate(config?.LastModified)}</Box>
          </SpaceBetween>
        </SpaceBetween>
      </div>
    </Container>
  );
}

/** A minimal SAM-style view of the function, read-only — AWS's Template toggle equivalent. */
function templateYaml(config: FunctionConfiguration | null): string {
  if (config === null) {
    return "# No function loaded.";
  }
  return [
    "AWSTemplateFormatVersion: '2010-09-09'",
    "Transform: AWS::Serverless-2016-10-31",
    "Resources:",
    `  ${(config.FunctionName ?? "Function").replace(/[^A-Za-z0-9]/g, "")}:`,
    "    Type: AWS::Serverless::Function",
    "    Properties:",
    `      FunctionName: ${config.FunctionName ?? ""}`,
    `      Runtime: ${config.Runtime ?? ""}`,
    `      Handler: ${config.Handler ?? ""}`,
    `      MemorySize: ${config.MemorySize ?? 128}`,
    `      Timeout: ${config.Timeout ?? 3}`,
    `      Architectures: [${(config.Architectures ?? ["x86_64"]).join(", ")}]`,
    `      Role: ${config.Role ?? ""}`,
  ].join("\n");
}
