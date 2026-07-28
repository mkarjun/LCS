import { useEffect, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";

import { describeAwsError } from "@platform/awsClient";

interface UploadObjectModalProps {
  visible: boolean;
  bucketName: string;
  onDismiss: () => void;
  onSubmit: (key: string, body: string, contentType: string) => Promise<void>;
}

export function UploadObjectModal({
  visible,
  bucketName,
  onDismiss,
  onSubmit,
}: UploadObjectModalProps) {
  const [key, setKey] = useState("");
  const [body, setBody] = useState("");
  const [contentType, setContentType] = useState("text/plain");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (visible) {
      setKey("");
      setBody("");
      setContentType("text/plain");
      setKeyError(null);
      setFormError(null);
      setTouched(false);
    }
  }, [visible]);

  const validate = (candidate: string): string | null => {
    if (candidate.trim() === "") {
      return "Object key is required.";
    }
    if (candidate.startsWith("/")) {
      return "Object key can't start with a slash.";
    }
    return null;
  };

  const submit = async () => {
    setTouched(true);
    const message = validate(key);
    setKeyError(message);
    if (message !== null) {
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await onSubmit(key.trim(), body, contentType.trim() || "text/plain");
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
      header={`Upload to "${bucketName}"`}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Upload
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <FormField
            label="Object key"
            description="Use slashes to organize objects into folders, for example notes/hello.txt."
            errorText={touched ? keyError : null}
          >
            <Input
              value={key}
              autoFocus
              placeholder="notes/hello.txt"
              onChange={(event) => {
                setKey(event.detail.value);
                if (touched) {
                  setKeyError(validate(event.detail.value));
                }
              }}
              onBlur={() => {
                setTouched(true);
                setKeyError(validate(key));
              }}
            />
          </FormField>
          <FormField label="Content type">
            <Input
              value={contentType}
              onChange={(event) => setContentType(event.detail.value)}
              placeholder="text/plain"
            />
          </FormField>
          <FormField
            label="Content"
            description="This console uploads text content. Use the CLI or an SDK for binary objects and multipart uploads."
          >
            <Textarea
              value={body}
              rows={8}
              onChange={(event) => setBody(event.detail.value)}
              placeholder="Hello from LCS"
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
