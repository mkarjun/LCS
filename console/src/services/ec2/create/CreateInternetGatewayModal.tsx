import { useEffect, useState } from "react";
import { CreateInternetGatewayCommand } from "@aws-sdk/client-ec2";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";

import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { useNotifications } from "@shell/NotificationContext";
import { useEc2Client } from "../useEc2Client";
import { CreateModalShell } from "./CreateModalShell";
import { tagSpecifications, useCreateForm } from "./createForm";
import type { Ec2CreateModalProps } from "./createForm";

/**
 * AWS's "Create internet gateway" page, which takes a name and tags only — attaching the
 * gateway to a VPC is a separate action afterwards, and that is how AWS orders it too.
 */
export function CreateInternetGatewayModal({
  visible,
  onDismiss,
  onCreated,
}: Ec2CreateModalProps) {
  const client = useEc2Client();
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
        new CreateInternetGatewayCommand({
          TagSpecifications: tagSpecifications("internet-gateway", name, tags),
        }),
      );
      notify({
        type: "success",
        header: `Internet gateway ${created.InternetGateway?.InternetGatewayId} created`,
        content: "Attach it to a VPC to allow traffic between the VPC and the internet.",
      });
      await onCreated();
    });
  };

  return (
    <CreateModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Create internet gateway"
      submitLabel="Create internet gateway"
      onSubmit={onSubmit}
      submitting={submitting}
      formError={formError}
    >
      <FormField
        label="Name tag"
        description="Creates a tag with a key of 'Name' and the value you specify."
      >
        <Input
          value={name}
          autoFocus
          placeholder="my-igw"
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
          empty="No tags associated with this internet gateway."
        />
      </FormField>
    </CreateModalShell>
  );
}
