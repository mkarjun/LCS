import { useCallback, useEffect, useState } from "react";
import { CreateRouteTableCommand } from "@aws-sdk/client-ec2";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import type { SelectProps } from "@cloudscape-design/components/select";

import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { useNotifications } from "@shell/NotificationContext";
import { useEc2Client } from "../useEc2Client";
import { CreateModalShell } from "./CreateModalShell";
import { loadVpcOptions, tagSpecifications, useCreateForm } from "./createForm";
import type { Ec2CreateModalProps } from "./createForm";

export function CreateRouteTableModal({ visible, onDismiss, onCreated }: Ec2CreateModalProps) {
  const client = useEc2Client();
  const { notify } = useNotifications();
  const { formError, setFormError, submitting, submit } = useCreateForm();

  const [name, setName] = useState("");
  const [vpcs, setVpcs] = useState<SelectProps.Option[]>([]);
  const [vpc, setVpc] = useState<SelectProps.Option | null>(null);
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
      setTags([]);
      setFormError(null);
      void loadVpcs();
    }
  }, [visible, loadVpcs, setFormError]);

  const onSubmit = () => {
    if (vpc === null || !vpc.value) {
      setFormError("Choose the VPC to create the route table in.");
      return;
    }
    void submit(async () => {
      const created = await client.send(
        new CreateRouteTableCommand({
          VpcId: vpc.value,
          TagSpecifications: tagSpecifications("route-table", name, tags),
        }),
      );
      notify({
        type: "success",
        content: `Route table ${created.RouteTable?.RouteTableId} created.`,
      });
      await onCreated();
    });
  };

  return (
    <CreateModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Create route table"
      submitLabel="Create route table"
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
          placeholder="my-route-table"
          onChange={(event) => setName(event.detail.value)}
        />
      </FormField>
      <FormField label="VPC" description="The VPC the route table belongs to.">
        <Select
          selectedOption={vpc}
          options={vpcs}
          placeholder={vpcs.length === 0 ? "No VPCs in this Region" : "Choose a VPC"}
          onChange={(event) => setVpc(event.detail.selectedOption)}
        />
      </FormField>
      <FormField label="Tags">
        <KeyValueEditor
          items={tags}
          onChange={setTags}
          keyLabel="Key"
          valueLabel="Value"
          addLabel="Add new tag"
          empty="No tags associated with this route table."
        />
      </FormField>
    </CreateModalShell>
  );
}
