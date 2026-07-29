import { useEffect, useState } from "react";
import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { SelectProps } from "@cloudscape-design/components/select";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";

const TYPES: SelectProps.Option[] = [
  { label: "String", value: "S" },
  { label: "Number", value: "N" },
  { label: "Binary", value: "B" },
];

export function CreateTableModal({
  visible,
  onDismiss,
  onCreated,
}: {
  visible: boolean;
  onDismiss: () => void;
  onCreated: () => Promise<void>;
}) {
  const client = useAwsClient(DynamoDBClient);
  const { notify } = useNotifications();

  const [name, setName] = useState("");
  const [pkName, setPkName] = useState("");
  const [pkType, setPkType] = useState<SelectProps.Option>(TYPES[0]);
  const [skName, setSkName] = useState("");
  const [skType, setSkType] = useState<SelectProps.Option>(TYPES[0]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setName("");
      setPkName("");
      setSkName("");
      setPkType(TYPES[0]);
      setSkType(TYPES[0]);
      setFormError(null);
    }
  }, [visible]);

  const submit = async () => {
    if (name.trim() === "" || pkName.trim() === "") {
      setFormError("Table name and partition key are required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      // A sort key is optional; when present it must appear in both the key schema and
      // the attribute definitions, or DynamoDB rejects the request.
      const hasSortKey = skName.trim() !== "";
      await client.send(
        new CreateTableCommand({
          TableName: name.trim(),
          BillingMode: "PAY_PER_REQUEST",
          AttributeDefinitions: [
            { AttributeName: pkName.trim(), AttributeType: pkType.value as never },
            ...(hasSortKey
              ? [{ AttributeName: skName.trim(), AttributeType: skType.value as never }]
              : []),
          ],
          KeySchema: [
            { AttributeName: pkName.trim(), KeyType: "HASH" },
            ...(hasSortKey ? [{ AttributeName: skName.trim(), KeyType: "RANGE" as const }] : []),
          ],
        }),
      );
      notify({ type: "success", content: `Table "${name.trim()}" created.` });
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
      header="Create table"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Create table
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <FormField
            label="Table name"
            description="This will be the unique name for this table in the Region."
          >
            <Input
              value={name}
              autoFocus
              placeholder="Orders"
              onChange={(event) => setName(event.detail.value)}
            />
          </FormField>
          <FormField
            label="Partition key"
            description="The partition key is part of the table's primary key."
          >
            <SpaceBetween size="xs" direction="horizontal">
              <Input
                value={pkName}
                placeholder="orderId"
                onChange={(event) => setPkName(event.detail.value)}
              />
              <Select
                selectedOption={pkType}
                options={TYPES}
                onChange={(event) => setPkType(event.detail.selectedOption)}
              />
            </SpaceBetween>
          </FormField>
          <FormField label="Sort key - optional">
            <SpaceBetween size="xs" direction="horizontal">
              <Input
                value={skName}
                placeholder="createdAt"
                onChange={(event) => setSkName(event.detail.value)}
              />
              <Select
                selectedOption={skType}
                options={TYPES}
                onChange={(event) => setSkType(event.detail.selectedOption)}
              />
            </SpaceBetween>
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
