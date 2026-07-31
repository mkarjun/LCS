import { useEffect, useState } from "react";
import { AllocateAddressCommand } from "@aws-sdk/client-ec2";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";

import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { useNotifications } from "@shell/NotificationContext";
import { useEmulator } from "@platform/EmulatorContext";
import { useEc2Client } from "../useEc2Client";
import { CreateModalShell } from "./CreateModalShell";
import { tagSpecifications, useCreateForm } from "./createForm";
import type { Ec2CreateModalProps } from "./createForm";

/**
 * AWS's "Allocate Elastic IP address" page.
 *
 * The public IPv4 address pool choice (Amazon's pool / a customer-owned pool / BYOIP) is
 * omitted: LCS always allocates from its own synthetic pool and has no BYOIP or
 * customer-owned pool concept, so the radio group would have one live option.
 */
export function AllocateAddressModal({ visible, onDismiss, onCreated }: Ec2CreateModalProps) {
  const client = useEc2Client();
  const { region } = useEmulator();
  const { notify } = useNotifications();
  const { formError, setFormError, submitting, submit } = useCreateForm();

  const [name, setName] = useState("");
  const [tags, setTags] = useState<KeyValuePair[]>([]);

  useEffect(() => {
    if (visible) {
      setName("");
      setTags([]);
      setFormError(null);
    }
  }, [visible, setFormError]);

  const onSubmit = () => {
    void submit(async () => {
      const created = await client.send(
        new AllocateAddressCommand({
          Domain: "vpc",
          TagSpecifications: tagSpecifications("elastic-ip", name, tags),
        }),
      );
      notify({
        type: "success",
        content: `Elastic IP address ${created.PublicIp} allocated (${created.AllocationId}).`,
      });
      await onCreated();
    });
  };

  return (
    <CreateModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Allocate Elastic IP address"
      submitLabel="Allocate"
      onSubmit={onSubmit}
      submitting={submitting}
      formError={formError}
    >
      <FormField
        label="Network border group"
        description="The group of Availability Zones from which the address is advertised."
      >
        <Input value={region} disabled readOnly onChange={() => undefined} />
      </FormField>
      <FormField
        label="Name"
        description="Creates a tag with a key of 'Name' and the value you specify."
      >
        <Input
          value={name}
          autoFocus
          placeholder="my-elastic-ip"
          onChange={(event) => setName(event.detail.value)}
        />
      </FormField>
      <FormField label="Tags">
        <KeyValueEditor
          items={tags}
          onChange={setTags}
          keyLabel="Key"
          valueLabel="Value"
          addLabel="Add new tag"
          empty="No tags associated with this Elastic IP address."
        />
      </FormField>
    </CreateModalShell>
  );
}
