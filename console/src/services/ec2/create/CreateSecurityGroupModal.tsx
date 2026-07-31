import { useCallback, useEffect, useState } from "react";
import {
  AuthorizeSecurityGroupEgressCommand,
  AuthorizeSecurityGroupIngressCommand,
  CreateSecurityGroupCommand,
} from "@aws-sdk/client-ec2";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import type { SelectProps } from "@cloudscape-design/components/select";

import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { useNotifications } from "@shell/NotificationContext";
import { useEc2Client } from "../useEc2Client";
import {
  SecurityGroupRulesEditor,
  permissionsFromDrafts,
  validateRuleDrafts,
} from "../SecurityGroupRulesEditor";
import type { SgRuleDraft } from "../SecurityGroupRulesEditor";
import { CreateModalShell } from "./CreateModalShell";
import { loadVpcOptions, tagSpecifications, useCreateForm } from "./createForm";
import type { Ec2CreateModalProps } from "./createForm";

/** The name rule EC2 documents for VPC security groups. */
function validateGroupName(name: string): string | null {
  if (name === "") {
    return "Security group name is required.";
  }
  if (name.length > 255) {
    return "Security group name can be up to 255 characters.";
  }
  if (name.startsWith("sg-")) {
    return 'Security group name cannot start with "sg-".';
  }
  if (!/^[\w .:/()#,@[\]+=&;{}!$*-]+$/.test(name)) {
    return "Security group name can use only a-z, A-Z, 0-9, spaces and . _ - : / ( ) # , @ [ ] + = & ; { } ! $ *";
  }
  return null;
}

export function CreateSecurityGroupModal({
  visible,
  onDismiss,
  onCreated,
}: Ec2CreateModalProps) {
  const client = useEc2Client();
  const { notify } = useNotifications();
  const { formError, setFormError, submitting, submit } = useCreateForm();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [vpcs, setVpcs] = useState<SelectProps.Option[]>([]);
  const [vpc, setVpc] = useState<SelectProps.Option | null>(null);
  const [inbound, setInbound] = useState<SgRuleDraft[]>([]);
  const [outbound, setOutbound] = useState<SgRuleDraft[]>([]);
  const [tags, setTags] = useState<KeyValuePair[]>([]);

  const loadVpcs = useCallback(async () => {
    try {
      const options = await loadVpcOptions(client);
      setVpcs(options);
      setVpc(options[0] ?? null);
    } catch {
      setVpcs([]);
    }
  }, [client]);

  useEffect(() => {
    if (visible) {
      setName("");
      setDescription("");
      setInbound([]);
      setOutbound([]);
      setTags([]);
      setFormError(null);
      void loadVpcs();
    }
  }, [visible, loadVpcs, setFormError]);

  const onSubmit = () => {
    const nameError = validateGroupName(name.trim());
    if (nameError !== null) {
      setFormError(nameError);
      return;
    }
    if (description.trim() === "") {
      setFormError("Description is required.");
      return;
    }
    if (vpc === null || !vpc.value) {
      setFormError("Choose a VPC for the security group.");
      return;
    }
    const ruleError = validateRuleDrafts([...inbound, ...outbound]);
    if (ruleError !== null) {
      setFormError(ruleError);
      return;
    }

    void submit(async () => {
      const created = await client.send(
        new CreateSecurityGroupCommand({
          GroupName: name.trim(),
          Description: description.trim(),
          VpcId: vpc.value,
          TagSpecifications: tagSpecifications("security-group", "", tags),
        }),
      );
      const groupId = created.GroupId;
      // Rules are separate API calls, so the group exists even if a rule is rejected.
      // Report that rather than leaving the user thinking nothing happened.
      const ingress = permissionsFromDrafts(inbound);
      if (groupId && ingress.length > 0) {
        await client.send(
          new AuthorizeSecurityGroupIngressCommand({ GroupId: groupId, IpPermissions: ingress }),
        );
      }
      const egress = permissionsFromDrafts(outbound);
      if (groupId && egress.length > 0) {
        await client.send(
          new AuthorizeSecurityGroupEgressCommand({ GroupId: groupId, IpPermissions: egress }),
        );
      }
      notify({ type: "success", content: `Security group "${name.trim()}" (${groupId}) created.` });
      await onCreated();
    });
  };

  return (
    <CreateModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Create security group"
      submitLabel="Create security group"
      onSubmit={onSubmit}
      submitting={submitting}
      formError={formError}
      size="large"
    >
      <FormField
        label="Security group name"
        description="Cannot be edited after creation."
        constraintText="Up to 255 characters. Cannot start with sg-."
      >
        <Input
          value={name}
          autoFocus
          placeholder="my-security-group"
          onChange={(event) => setName(event.detail.value)}
        />
      </FormField>
      <FormField label="Description">
        <Input
          value={description}
          placeholder="Allow inbound SSH from the office"
          onChange={(event) => setDescription(event.detail.value)}
        />
      </FormField>
      <FormField label="VPC" description="The VPC the security group belongs to.">
        <Select
          selectedOption={vpc}
          options={vpcs}
          placeholder={vpcs.length === 0 ? "No VPCs in this Region" : "Choose a VPC"}
          onChange={(event) => setVpc(event.detail.selectedOption)}
        />
      </FormField>
      <FormField
        label="Inbound rules"
        description="Inbound rules control the incoming traffic that is allowed to reach the instance."
      >
        <SecurityGroupRulesEditor direction="inbound" rules={inbound} onChange={setInbound} />
      </FormField>
      <FormField
        label="Outbound rules"
        description="Outbound rules control the outgoing traffic that is allowed to leave the instance."
      >
        <SecurityGroupRulesEditor direction="outbound" rules={outbound} onChange={setOutbound} />
      </FormField>
      <FormField label="Tags">
        <KeyValueEditor
          items={tags}
          onChange={setTags}
          keyLabel="Key"
          valueLabel="Value"
          addLabel="Add new tag"
          empty="No tags associated with this security group."
        />
      </FormField>
    </CreateModalShell>
  );
}
