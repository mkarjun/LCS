import { useEffect, useState } from "react";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import type { AttributeValue, TableDescription } from "@aws-sdk/client-dynamodb";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";

/**
 * Creates an item from plain JSON.
 *
 * The AWS console offers a form builder and a JSON view; this is the JSON view. Values
 * are written as ordinary JSON and converted to DynamoDB's typed wire format here, so
 * the user does not have to hand-write {"S": "..."} wrappers.
 */
function toAttributeValue(value: unknown): AttributeValue {
  if (value === null) {
    return { NULL: true };
  }
  if (typeof value === "string") {
    return { S: value };
  }
  if (typeof value === "number") {
    return { N: String(value) };
  }
  if (typeof value === "boolean") {
    return { BOOL: value };
  }
  if (Array.isArray(value)) {
    return { L: value.map((entry) => toAttributeValue(entry)) };
  }
  if (typeof value === "object") {
    const map: Record<string, AttributeValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      map[key] = toAttributeValue(entry);
    }
    return { M: map };
  }
  return { S: String(value) };
}

export function PutItemModal({
  visible,
  tableName,
  table,
  onDismiss,
  onCreated,
}: {
  visible: boolean;
  tableName: string;
  table: TableDescription | null;
  onDismiss: () => void;
  onCreated: () => Promise<void>;
}) {
  const client = useAwsClient(DynamoDBClient);
  const { notify } = useNotifications();
  const [json, setJson] = useState("{}");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }
    // Pre-fill the key attributes so the required shape is obvious.
    const skeleton: Record<string, string> = {};
    for (const key of table?.KeySchema ?? []) {
      if (key.AttributeName) {
        const definition = (table?.AttributeDefinitions ?? []).find(
          (attribute) => attribute.AttributeName === key.AttributeName,
        );
        skeleton[key.AttributeName] = definition?.AttributeType === "N" ? "0" : "";
      }
    }
    setJson(JSON.stringify(skeleton, null, 2));
    setFormError(null);
  }, [visible, table]);

  const submit = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json) as Record<string, unknown>;
    } catch (error) {
      setFormError(`Invalid JSON: ${(error as Error).message}`);
      return;
    }

    const item: Record<string, AttributeValue> = {};
    for (const [key, value] of Object.entries(parsed)) {
      item[key] = toAttributeValue(value);
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await client.send(new PutItemCommand({ TableName: tableName, Item: item }));
      notify({ type: "success", content: "Item created." });
      await onCreated();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFormError(`${title}: ${detail}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Create item"
      size="large"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Create item
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <FormField
          label="Item JSON"
          description="Plain JSON. Attribute types are inferred, so DynamoDB type wrappers are not needed."
        >
          <Textarea value={json} rows={14} onChange={(event) => setJson(event.detail.value)} />
        </FormField>
      </Form>
    </Modal>
  );
}
