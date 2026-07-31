import { useCallback, useEffect, useState } from "react";
import { CreateSubnetCommand } from "@aws-sdk/client-ec2";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import type { SelectProps } from "@cloudscape-design/components/select";

import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { useNotifications } from "@shell/NotificationContext";
import { useEc2Client } from "../useEc2Client";
import { CreateModalShell } from "./CreateModalShell";
import {
  loadAvailabilityZoneOptions,
  loadVpcOptions,
  tagSpecifications,
  useCreateForm,
} from "./createForm";
import type { Ec2CreateModalProps } from "./createForm";
import { validateIpv4Cidr } from "./cidr";

/** AWS's default is "No preference", which lets EC2 pick the zone. */
const NO_PREFERENCE: SelectProps.Option = { value: "", label: "No preference" };

export function CreateSubnetModal({ visible, onDismiss, onCreated }: Ec2CreateModalProps) {
  const client = useEc2Client();
  const { notify } = useNotifications();
  const { formError, setFormError, submitting, submit } = useCreateForm();

  const [vpcs, setVpcs] = useState<SelectProps.Option[]>([]);
  const [vpc, setVpc] = useState<SelectProps.Option | null>(null);
  const [zones, setZones] = useState<SelectProps.Option[]>([NO_PREFERENCE]);
  const [zone, setZone] = useState<SelectProps.Option>(NO_PREFERENCE);
  const [name, setName] = useState("");
  const [cidr, setCidr] = useState("10.0.1.0/24");
  const [tags, setTags] = useState<KeyValuePair[]>([]);

  const loadOptions = useCallback(async () => {
    const [vpcResult, zoneResult] = await Promise.allSettled([
      loadVpcOptions(client),
      loadAvailabilityZoneOptions(client),
    ]);
    if (vpcResult.status === "fulfilled") {
      setVpcs(vpcResult.value);
      setVpc(vpcResult.value[0] ?? null);
    }
    if (zoneResult.status === "fulfilled") {
      setZones([NO_PREFERENCE, ...zoneResult.value]);
    }
  }, [client]);

  useEffect(() => {
    if (visible) {
      setName("");
      setCidr("10.0.1.0/24");
      setZone(NO_PREFERENCE);
      setTags([]);
      setFormError(null);
      void loadOptions();
    }
  }, [visible, loadOptions, setFormError]);

  const onSubmit = () => {
    if (vpc === null || !vpc.value) {
      setFormError("Choose the VPC to create the subnet in.");
      return;
    }
    const cidrError = validateIpv4Cidr(cidr, { min: 16, max: 28 });
    if (cidrError !== null) {
      setFormError(cidrError);
      return;
    }
    void submit(async () => {
      const created = await client.send(
        new CreateSubnetCommand({
          VpcId: vpc.value,
          CidrBlock: cidr.trim(),
          ...(zone.value ? { AvailabilityZone: zone.value } : {}),
          TagSpecifications: tagSpecifications("subnet", name, tags),
        }),
      );
      notify({
        type: "success",
        content: `Subnet ${created.Subnet?.SubnetId} created in ${created.Subnet?.AvailabilityZone}.`,
      });
      await onCreated();
    });
  };

  return (
    <CreateModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Create subnet"
      submitLabel="Create subnet"
      onSubmit={onSubmit}
      submitting={submitting}
      formError={formError}
    >
      <FormField label="VPC ID" description="Create the subnet in the selected VPC.">
        <Select
          selectedOption={vpc}
          options={vpcs}
          placeholder={vpcs.length === 0 ? "No VPCs in this Region" : "Choose a VPC"}
          onChange={(event) => setVpc(event.detail.selectedOption)}
        />
      </FormField>
      <FormField
        label="Subnet name"
        description="Creates a tag with a key of 'Name' and the value you specify."
      >
        <Input
          value={name}
          autoFocus
          placeholder="my-subnet"
          onChange={(event) => setName(event.detail.value)}
        />
      </FormField>
      <FormField label="Availability Zone">
        <Select
          selectedOption={zone}
          options={zones}
          onChange={(event) => setZone(event.detail.selectedOption)}
        />
      </FormField>
      <FormField
        label="IPv4 subnet CIDR block"
        constraintText="Must be within the VPC's CIDR block, sized between /16 and /28."
      >
        <Input value={cidr} onChange={(event) => setCidr(event.detail.value)} />
      </FormField>
      <FormField label="Tags">
        <KeyValueEditor
          items={tags}
          onChange={setTags}
          keyLabel="Key"
          valueLabel="Value"
          addLabel="Add new tag"
          empty="No tags associated with this subnet."
        />
      </FormField>
    </CreateModalShell>
  );
}
