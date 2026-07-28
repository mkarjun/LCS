import { useEffect, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { describeAwsError } from "@platform/awsClient";
import { useEmulator } from "@platform/EmulatorContext";

interface CreateBucketModalProps {
  visible: boolean;
  existingNames: string[];
  onDismiss: () => void;
  onSubmit: (name: string, region: string) => Promise<void>;
}

/**
 * Validates against the S3 bucket naming rules AWS enforces at create time, so the
 * console reports the same problems the API would.
 */
function validateBucketName(name: string, existingNames: string[]): string | null {
  if (name === "") {
    return "Bucket name is required.";
  }
  if (name.length < 3 || name.length > 63) {
    return "Bucket name must be between 3 and 63 characters.";
  }
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) {
    return "Bucket name can use only lowercase letters, numbers, hyphens, and periods, and must start and end with a letter or number.";
  }
  if (/\.\./.test(name)) {
    return "Bucket name can't contain two adjacent periods.";
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) {
    return "Bucket name can't be formatted as an IP address.";
  }
  if (name.startsWith("xn--") || name.startsWith("sthree-")) {
    return "Bucket name can't start with the reserved prefixes \"xn--\" or \"sthree-\".";
  }
  if (name.endsWith("-s3alias") || name.endsWith("--ol-s3")) {
    return "Bucket name can't end with the reserved suffixes \"-s3alias\" or \"--ol-s3\".";
  }
  if (existingNames.includes(name)) {
    return "A bucket with this name already exists.";
  }
  return null;
}

export function CreateBucketModal({
  visible,
  existingNames,
  onDismiss,
  onSubmit,
}: CreateBucketModalProps) {
  const { region } = useEmulator();
  const [name, setName] = useState("");
  const [bucketRegion, setBucketRegion] = useState(region);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (visible) {
      setName("");
      setBucketRegion(region);
      setError(null);
      setFormError(null);
      setTouched(false);
    }
  }, [visible, region]);

  // AWS validates on blur and on submit, not on every keystroke.
  const runValidation = () => {
    const message = validateBucketName(name.trim(), existingNames);
    setError(message);
    return message === null;
  };

  const submit = async () => {
    setTouched(true);
    if (!runValidation()) {
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await onSubmit(name.trim(), bucketRegion.trim() || region);
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
      header="Create bucket"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Create bucket
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <FormField
            label="Bucket name"
            description="Bucket names must be globally unique and can't be changed after creation."
            errorText={touched ? error : null}
            constraintText="3-63 characters. Lowercase letters, numbers, hyphens, and periods only."
          >
            <Input
              value={name}
              autoFocus
              placeholder="my-bucket"
              onChange={(event) => {
                setName(event.detail.value);
                if (touched) {
                  setError(validateBucketName(event.detail.value.trim(), existingNames));
                }
              }}
              onBlur={() => {
                setTouched(true);
                runValidation();
              }}
            />
          </FormField>
          <FormField
            label="AWS Region"
            description="LCS accepts any region name."
          >
            <Input
              value={bucketRegion}
              onChange={(event) => setBucketRegion(event.detail.value)}
              placeholder={region}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
