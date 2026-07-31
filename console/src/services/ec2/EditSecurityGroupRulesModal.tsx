import { useEffect, useState } from "react";
import {
  AuthorizeSecurityGroupEgressCommand,
  AuthorizeSecurityGroupIngressCommand,
  RevokeSecurityGroupEgressCommand,
  RevokeSecurityGroupIngressCommand,
} from "@aws-sdk/client-ec2";
import type { EC2Client, SecurityGroup } from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { describeAwsError } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";
import {
  SecurityGroupRulesEditor,
  draftsFromPermissions,
  permissionsFromDrafts,
  validateRuleDrafts,
} from "./SecurityGroupRulesEditor";
import type { SgRuleDraft } from "./SecurityGroupRulesEditor";

/**
 * AWS's "Edit inbound rules" / "Edit outbound rules" pages.
 *
 * EC2 has no replace-rules call, so the save is revoke-then-authorize: the group's current
 * permissions are revoked and the edited set is authorized. Revoke runs first because
 * authorizing a rule that already exists fails with `InvalidPermission.Duplicate`, and it
 * is skipped when there is nothing to revoke — EC2 rejects an empty permission list.
 */
export function EditSecurityGroupRulesModal({
  visible,
  onDismiss,
  onDone,
  client,
  group,
  direction,
}: {
  visible: boolean;
  onDismiss: () => void;
  onDone: () => Promise<void>;
  client: EC2Client;
  group: SecurityGroup;
  direction: "inbound" | "outbound";
}) {
  const { notify } = useNotifications();
  const [rules, setRules] = useState<SgRuleDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const existing = direction === "inbound" ? group.IpPermissions : group.IpPermissionsEgress;

  useEffect(() => {
    if (visible) {
      setRules(draftsFromPermissions(existing));
      setFormError(null);
    }
    // `existing` is a fresh array identity per load; the modal only needs it on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const submit = async () => {
    const ruleError = validateRuleDrafts(rules);
    if (ruleError !== null) {
      setFormError(ruleError);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const current = existing ?? [];
      const input = { GroupId: group.GroupId, IpPermissions: current };
      if (current.length > 0) {
        // The ingress and egress commands have distinct input types, so the branch has to
        // be around the whole send rather than around the command.
        if (direction === "inbound") {
          await client.send(new RevokeSecurityGroupIngressCommand(input));
        } else {
          await client.send(new RevokeSecurityGroupEgressCommand(input));
        }
      }
      const next = permissionsFromDrafts(rules);
      if (next.length > 0) {
        const nextInput = { GroupId: group.GroupId, IpPermissions: next };
        if (direction === "inbound") {
          await client.send(new AuthorizeSecurityGroupIngressCommand(nextInput));
        } else {
          await client.send(new AuthorizeSecurityGroupEgressCommand(nextInput));
        }
      }
      notify({
        type: "success",
        content: `${direction === "inbound" ? "Inbound" : "Outbound"} rules for ${group.GroupId} updated.`,
      });
      await onDone();
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
      size="large"
      header={`Edit ${direction} rules — ${group.GroupName ?? group.GroupId}`}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Save rules
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="m">
          <Box variant="p" color="text-body-secondary">
            {direction === "inbound"
              ? "Inbound rules control the incoming traffic that is allowed to reach the instance."
              : "Outbound rules control the outgoing traffic that is allowed to leave the instance."}
          </Box>
          <SecurityGroupRulesEditor direction={direction} rules={rules} onChange={setRules} />
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
