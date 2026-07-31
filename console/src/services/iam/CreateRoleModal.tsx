import { useCallback, useEffect, useState } from "react";
import { AttachRolePolicyCommand, CreateRoleCommand } from "@aws-sdk/client-iam";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Multiselect from "@cloudscape-design/components/multiselect";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Textarea from "@cloudscape-design/components/textarea";
import type { MultiselectProps } from "@cloudscape-design/components/multiselect";
import type { SelectProps } from "@cloudscape-design/components/select";

import { describeAwsError } from "@platform/awsClient";
import { useEmulator } from "@platform/EmulatorContext";
import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { useNotifications } from "@shell/NotificationContext";
import { useIamClient } from "./useIamClient";
import { loadPolicyOptions, validateIamName, validatePolicyDocument } from "./policyPicker";
import { SERVICE_PRINCIPALS, accountTrustPolicy, serviceTrustPolicy } from "./trustPolicy";

interface CreateRoleModalProps {
  visible: boolean;
  onDismiss: () => void;
  onCreated: () => void;
}

const CUSTOM_TRUST_TEMPLATE = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
`;

/**
 * AWS's "Create role" flow, collapsed from a three-step wizard into one form.
 *
 * Trusted entity types offered are the three LCS can back. Web identity and SAML 2.0
 * federation are left out: `ListOpenIDConnectProviders` and `ListSAMLProviders` answer,
 * but there is no `CreateOpenIDConnectProvider` or `CreateSAMLProvider`, so the provider
 * picker those options depend on could never have an entry.
 */
export function CreateRoleModal({ visible, onDismiss, onCreated }: CreateRoleModalProps) {
  const client = useIamClient();
  const { effectiveAccountId } = useEmulator();
  const { notify } = useNotifications();

  const [entityType, setEntityType] = useState("service");
  const [servicePrincipal, setServicePrincipal] = useState<SelectProps.Option>(
    SERVICE_PRINCIPALS[0],
  );
  const [accountChoice, setAccountChoice] = useState("this");
  const [otherAccountId, setOtherAccountId] = useState("");
  const [requireMfa, setRequireMfa] = useState(false);
  const [externalId, setExternalId] = useState("");
  const [customTrust, setCustomTrust] = useState(CUSTOM_TRUST_TEMPLATE);

  const [policyOptions, setPolicyOptions] = useState<MultiselectProps.Options>([]);
  const [policies, setPolicies] = useState<readonly MultiselectProps.Option[]>([]);
  const [roleName, setRoleName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<KeyValuePair[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadPolicies = useCallback(async () => {
    try {
      setPolicyOptions(await loadPolicyOptions(client));
    } catch {
      setPolicyOptions([]);
    }
  }, [client]);

  useEffect(() => {
    if (visible) {
      setEntityType("service");
      setServicePrincipal(SERVICE_PRINCIPALS[0]);
      setAccountChoice("this");
      setOtherAccountId("");
      setRequireMfa(false);
      setExternalId("");
      setCustomTrust(CUSTOM_TRUST_TEMPLATE);
      setPolicies([]);
      setRoleName("");
      setDescription("");
      setTags([]);
      setFormError(null);
      void loadPolicies();
    }
  }, [visible, loadPolicies]);

  /** Resolves the form to the document CreateRole takes, or an error to show instead. */
  const buildTrustPolicy = (): { document: string } | { error: string } => {
    if (entityType === "service") {
      return { document: serviceTrustPolicy(String(servicePrincipal.value)) };
    }
    if (entityType === "account") {
      const accountId = accountChoice === "this" ? effectiveAccountId : otherAccountId.trim();
      if (!/^\d{12}$/.test(accountId)) {
        return { error: "An AWS account ID is 12 digits." };
      }
      return { document: accountTrustPolicy(accountId, { requireMfa, externalId }) };
    }
    const documentError = validatePolicyDocument(customTrust);
    return documentError === null ? { document: customTrust } : { error: documentError };
  };

  const submit = async () => {
    const nameError = validateIamName(roleName.trim(), "Role name", 64);
    if (nameError !== null) {
      setFormError(nameError);
      return;
    }
    const trust = buildTrustPolicy();
    if ("error" in trust) {
      setFormError(trust.error);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await client.send(
        new CreateRoleCommand({
          RoleName: roleName.trim(),
          AssumeRolePolicyDocument: trust.document,
          ...(description.trim() === "" ? {} : { Description: description.trim() }),
          Tags: tags
            .filter((tag) => tag.key.trim() !== "")
            .map((tag) => ({ Key: tag.key.trim(), Value: tag.value })),
        }),
      );
      // Attaching is a separate call per policy, and the role already exists by now — so a
      // failure here is reported against the created role rather than as "create failed".
      const failed: string[] = [];
      for (const policy of policies) {
        try {
          await client.send(
            new AttachRolePolicyCommand({
              RoleName: roleName.trim(),
              PolicyArn: String(policy.value),
            }),
          );
        } catch {
          failed.push(policy.label ?? String(policy.value));
        }
      }
      if (failed.length > 0) {
        notify({
          type: "warning",
          header: `Role "${roleName.trim()}" created, but some policies were not attached`,
          content: `Could not attach: ${failed.join(", ")}. Attach them from the role's Permissions tab.`,
        });
      } else {
        notify({ type: "success", content: `Role "${roleName.trim()}" created.` });
      }
      onCreated();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFormError(`${title}: ${detail}`);
    } finally {
      setSubmitting(false);
    }
  };

  const trustPreview = (() => {
    const trust = buildTrustPolicy();
    return "error" in trust ? trust.error : trust.document;
  })();

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Create role"
      size="large"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Create role
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <FormField
            label="Trusted entity type"
            description="Who or what can assume this role."
          >
            <RadioGroup
              value={entityType}
              onChange={(event) => setEntityType(event.detail.value)}
              items={[
                {
                  value: "service",
                  label: "AWS service",
                  description: "Allow an AWS service to perform actions in this account.",
                },
                {
                  value: "account",
                  label: "AWS account",
                  description:
                    "Allow entities in other AWS accounts, or this account, to perform actions here.",
                },
                {
                  value: "custom",
                  label: "Custom trust policy",
                  description: "Write the trust policy by hand.",
                },
                {
                  value: "web-identity",
                  label: "Web identity",
                  description:
                    "Not available in LCS — needs CreateOpenIDConnectProvider, which is not implemented.",
                  disabled: true,
                },
                {
                  value: "saml",
                  label: "SAML 2.0 federation",
                  description:
                    "Not available in LCS — needs CreateSAMLProvider, which is not implemented.",
                  disabled: true,
                },
              ]}
            />
          </FormField>

          {entityType === "service" && (
            <FormField label="Use case" description="The service that will use this role.">
              <Select
                selectedOption={servicePrincipal}
                options={SERVICE_PRINCIPALS}
                onChange={(event) => setServicePrincipal(event.detail.selectedOption)}
              />
            </FormField>
          )}

          {entityType === "account" && (
            <>
              <FormField label="An AWS account">
                <RadioGroup
                  value={accountChoice}
                  onChange={(event) => setAccountChoice(event.detail.value)}
                  items={[
                    { value: "this", label: `This account (${effectiveAccountId})` },
                    { value: "other", label: "Another AWS account" },
                  ]}
                />
              </FormField>
              {accountChoice === "other" && (
                <FormField label="Account ID" constraintText="12 digits, no hyphens.">
                  <Input
                    value={otherAccountId}
                    placeholder="123456789012"
                    onChange={(event) => setOtherAccountId(event.detail.value)}
                  />
                </FormField>
              )}
              <FormField
                label="Options"
                description="LCS records these conditions in the trust policy but sts:AssumeRole does not evaluate them."
              >
                <SpaceBetween size="xs">
                  <Checkbox
                    checked={requireMfa}
                    onChange={(event) => setRequireMfa(event.detail.checked)}
                  >
                    Require MFA
                  </Checkbox>
                  <Input
                    value={externalId}
                    placeholder="External ID (optional)"
                    onChange={(event) => setExternalId(event.detail.value)}
                  />
                </SpaceBetween>
              </FormField>
            </>
          )}

          {entityType === "custom" && (
            <FormField
              label="Custom trust policy"
              description="A JSON policy naming the principals allowed to assume this role."
            >
              <Textarea
                value={customTrust}
                rows={12}
                onChange={(event) => setCustomTrust(event.detail.value)}
              />
            </FormField>
          )}

          {entityType !== "custom" && (
            <ExpandableSection headerText="Trust policy preview">
              <Box variant="code">
                <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{trustPreview}</pre>
              </Box>
            </ExpandableSection>
          )}

          <FormField
            label="Permissions policies"
            description="Managed policies attached to the role once it is created."
          >
            <Multiselect
              selectedOptions={policies}
              options={policyOptions}
              filteringType="auto"
              placeholder="Choose policies"
              onChange={(event) => setPolicies(event.detail.selectedOptions)}
            />
          </FormField>

          <FormField label="Role name" constraintText="Up to 64 characters. Use alphanumeric and + = , . @ _ - characters.">
            <Input
              value={roleName}
              placeholder="my-role"
              onChange={(event) => setRoleName(event.detail.value)}
            />
          </FormField>
          <FormField label="Description">
            <Input
              value={description}
              placeholder="Allows Lambda functions to call AWS services on your behalf."
              onChange={(event) => setDescription(event.detail.value)}
            />
          </FormField>
          <FormField label="Tags">
            <KeyValueEditor
              items={tags}
              onChange={setTags}
              keyLabel="Key"
              valueLabel="Value"
              addLabel="Add new tag"
              empty="No tags associated with this role."
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
