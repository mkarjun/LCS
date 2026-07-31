import { useEffect, useState } from "react";
import { CreateVpcCommand } from "@aws-sdk/client-ec2";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import type { SelectProps } from "@cloudscape-design/components/select";

import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { useNotifications } from "@shell/NotificationContext";
import { useEc2Client } from "../useEc2Client";
import { CreateModalShell } from "./CreateModalShell";
import { tagSpecifications, useCreateForm } from "./createForm";
import type { Ec2CreateModalProps } from "./createForm";
import { validateIpv4Cidr } from "./cidr";

const TENANCIES: SelectProps.Option[] = [
  { value: "default", label: "Default" },
  { value: "dedicated", label: "Dedicated" },
];

/**
 * AWS's "Create VPC" page with "VPC only" selected. The "VPC and more" option builds
 * subnets, route tables, gateways and endpoints in one shot from a preview diagram; that
 * is a multi-resource orchestration on top of the same APIs and is not built.
 */
export function CreateVpcModal({ visible, onDismiss, onCreated }: Ec2CreateModalProps) {
  const client = useEc2Client();
  const { notify } = useNotifications();
  const { formError, setFormError, submitting, submit } = useCreateForm();

  const [name, setName] = useState("");
  const [cidr, setCidr] = useState("10.0.0.0/16");
  const [tenancy, setTenancy] = useState(TENANCIES[0]);
  const [tags, setTags] = useState<KeyValuePair[]>([]);

  useEffect(() => {
    if (visible) {
      setName("");
      setCidr("10.0.0.0/16");
      setTenancy(TENANCIES[0]);
      setTags([]);
      setFormError(null);
    }
  }, [visible, setFormError]);

  const onSubmit = () => {
    const cidrError = validateIpv4Cidr(cidr, { min: 16, max: 28 });
    if (cidrError !== null) {
      setFormError(cidrError);
      return;
    }
    void submit(async () => {
      const created = await client.send(
        new CreateVpcCommand({
          CidrBlock: cidr.trim(),
          InstanceTenancy: tenancy.value as "default" | "dedicated",
          TagSpecifications: tagSpecifications("vpc", name, tags),
        }),
      );
      notify({ type: "success", content: `VPC ${created.Vpc?.VpcId} created.` });
      await onCreated();
    });
  };

  return (
    <CreateModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Create VPC"
      submitLabel="Create VPC"
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
          placeholder="my-vpc"
          onChange={(event) => setName(event.detail.value)}
        />
      </FormField>
      <FormField
        label="IPv4 CIDR block"
        constraintText="CIDR block size must be between /16 and /28."
      >
        <Input value={cidr} onChange={(event) => setCidr(event.detail.value)} />
      </FormField>
      <FormField
        label="Tenancy"
        description="Whether instances launched into the VPC run on shared or single-tenant hardware."
      >
        <Select
          selectedOption={tenancy}
          options={TENANCIES}
          onChange={(event) => setTenancy(event.detail.selectedOption)}
        />
      </FormField>
      <FormField label="Tags">
        <KeyValueEditor
          items={tags}
          onChange={setTags}
          keyLabel="Key"
          valueLabel="Value"
          addLabel="Add new tag"
          empty="No tags associated with this VPC."
        />
      </FormField>
    </CreateModalShell>
  );
}
