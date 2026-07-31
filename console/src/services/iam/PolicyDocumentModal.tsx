import { useCallback, useEffect, useState } from "react";
import { GetPolicyCommand, GetPolicyVersionCommand } from "@aws-sdk/client-iam";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";

import { describeAwsError } from "@platform/awsClient";
import { dash, formatIamDate, formatPolicyDocument, useIamClient } from "./useIamClient";

/**
 * The policy document AWS shows on a policy's Permissions tab.
 *
 * The document is not in `ListPolicies`, so it is fetched here: `GetPolicy` for the
 * default version id and `GetPolicyVersion` for the document itself, which arrives
 * URL-encoded.
 */
export function PolicyDocumentModal({
  visible,
  onDismiss,
  policyArn,
  policyName,
}: {
  visible: boolean;
  onDismiss: () => void;
  policyArn: string;
  policyName: string;
}) {
  const client = useIamClient();
  const [document, setDocument] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<{
    versionId: string;
    description: string;
    updated: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDocument(null);
    try {
      const policy = await client.send(new GetPolicyCommand({ PolicyArn: policyArn }));
      const versionId = policy.Policy?.DefaultVersionId ?? "v1";
      setMetadata({
        versionId,
        description: dash(policy.Policy?.Description),
        updated: formatIamDate(policy.Policy?.UpdateDate),
      });
      const version = await client.send(
        new GetPolicyVersionCommand({ PolicyArn: policyArn, VersionId: versionId }),
      );
      setDocument(formatPolicyDocument(version.PolicyVersion?.Document));
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setError(`${title}: ${detail}`);
    } finally {
      setLoading(false);
    }
  }, [client, policyArn]);

  useEffect(() => {
    if (visible) {
      void load();
    }
  }, [visible, load]);

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header={policyName}
      size="large"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button
              disabled={document === null}
              onClick={() => {
                if (document !== null) {
                  void navigator.clipboard.writeText(document);
                }
              }}
            >
              Copy
            </Button>
            <Button variant="primary" onClick={onDismiss}>
              Close
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {error !== null && <Alert type="error">{error}</Alert>}
        {metadata !== null && (
          <KeyValuePairs
            columns={3}
            items={[
              { label: "ARN", value: policyArn },
              { label: "Default version", value: metadata.versionId },
              { label: "Last edited", value: metadata.updated },
              { label: "Description", value: metadata.description },
            ]}
          />
        )}
        {loading && <Spinner />}
        {document !== null && (
          <Box variant="code">
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowX: "auto" }}>{document}</pre>
          </Box>
        )}
      </SpaceBetween>
    </Modal>
  );
}
