import { useCallback, useEffect, useState } from "react";
import { CreateNetworkAclCommand } from "@aws-sdk/client-ec2";
import Alert from "@cloudscape-design/components/alert";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import type { SelectProps } from "@cloudscape-design/components/select";

import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { useNotifications } from "@shell/NotificationContext";
import { useEc2Client } from "../../useEc2Client";
import { CreateModalShell } from "../../create/CreateModalShell";
import { loadVpcOptions, tagSpecifications, useCreateForm } from "../../create/createForm";
import type { Ec2CreateModalProps } from "../../create/createForm";

/**
 * AWS's "Create network ACL" form: a name, the VPC it belongs to, and tags.
 *
 * A new ACL starts out denying everything in both directions — AWS says so on this screen
 * and it is the single most surprising thing about network ACLs, so the alert stays.
 */
export function CreateNetworkAclModal({ visible, onDismiss, onCreated }: Ec2CreateModalProps) {
  const client = useEc2Client();
  const { notify } = useNotifications();
  const { formError, setFormError, submitting, submit } = useCreateForm();

  const [name, setName] = useState("");
  const [vpcs, setVpcs] = useState<SelectProps.Option[]>([]);
  const [vpc, setVpc] = useState<SelectProps.Option | null>(null);
  const [tags, setTags] = useState<KeyValuePair[]>([]);

  const loadOptions = useCallback(async () => {
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
      setTags([]);
      setFormError(null);
      void loadOptions();
    }
  }, [visible, loadOptions, setFormError]);

  const onSubmit = () => {
    if (vpc === null || !vpc.value) {
      setFormError("Choose the VPC to create the network ACL in.");
      return;
    }
    void submit(async () => {
      const created = await client.send(
        new CreateNetworkAclCommand({
          VpcId: vpc.value,
          TagSpecifications: tagSpecifications("network-acl", name, tags),
        }),
      );
      notify({
        type: "success",
        content: `Network ACL ${created.NetworkAcl?.NetworkAclId} created in ${created.NetworkAcl?.VpcId}.`,
      });
      await onCreated();
    });
  };

  return (
    <CreateModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Create network ACL"
      submitLabel="Create network ACL"
      onSubmit={onSubmit}
      submitting={submitting}
      formError={formError}
    >
      <FormField
        label="Name"
        description="Creates a tag with a key of 'Name' and the value you specify."
      >
        <Input
          value={name}
          autoFocus
          placeholder="my-network-acl"
          onChange={(event) => setName(event.detail.value)}
        />
      </FormField>
      <FormField label="VPC" description="Create the network ACL in the selected VPC.">
        <Select
          selectedOption={vpc}
          options={vpcs}
          placeholder={vpcs.length === 0 ? "No VPCs in this Region" : "Choose a VPC"}
          onChange={(event) => setVpc(event.detail.selectedOption)}
        />
      </FormField>
      <Alert type="info">
        A network ACL created this way denies all inbound and outbound traffic until you add
        rules to it. Only the VPC&apos;s default ACL allows everything.
      </Alert>
      <FormField label="Tags">
        <KeyValueEditor
          items={tags}
          onChange={setTags}
          keyLabel="Key"
          valueLabel="Value"
          addLabel="Add new tag"
          empty="No tags associated with this network ACL."
        />
      </FormField>
    </CreateModalShell>
  );
}
