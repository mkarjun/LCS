import { useCallback, useEffect, useState } from "react";
import {
  CreateNatGatewayCommand,
  DescribeAddressesCommand,
  DescribeSubnetsCommand,
} from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import type { SelectProps } from "@cloudscape-design/components/select";

import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { useNotifications } from "@shell/NotificationContext";
import { nameTag, useEc2Client } from "../../useEc2Client";
import { CreateModalShell } from "../../create/CreateModalShell";
import { tagSpecifications, useCreateForm } from "../../create/createForm";
import type { Ec2CreateModalProps } from "../../create/createForm";

/**
 * AWS's "Create NAT gateway" form.
 *
 * A public gateway needs an Elastic IP; AWS offers "Allocate Elastic IP" inline on that
 * field. Here the field lists the addresses that are already allocated and unassociated,
 * because allocating one is its own screen in this console (VPC > Elastic IP addresses)
 * and silently allocating a billable-in-AWS resource from a second form would hide it.
 */
export function CreateNatGatewayModal({ visible, onDismiss, onCreated }: Ec2CreateModalProps) {
  const client = useEc2Client();
  const { notify } = useNotifications();
  const { formError, setFormError, submitting, submit } = useCreateForm();

  const [name, setName] = useState("");
  const [subnets, setSubnets] = useState<SelectProps.Option[]>([]);
  const [subnet, setSubnet] = useState<SelectProps.Option | null>(null);
  const [connectivity, setConnectivity] = useState("public");
  const [addresses, setAddresses] = useState<SelectProps.Option[]>([]);
  const [address, setAddress] = useState<SelectProps.Option | null>(null);
  const [tags, setTags] = useState<KeyValuePair[]>([]);

  const loadOptions = useCallback(async () => {
    const [subnetResult, addressResult] = await Promise.allSettled([
      client.send(new DescribeSubnetsCommand({})),
      client.send(new DescribeAddressesCommand({})),
    ]);

    if (subnetResult.status === "fulfilled") {
      const options = (subnetResult.value.Subnets ?? []).map((item) => {
        const label = nameTag(item.Tags);
        return {
          label: label === "—" ? (item.SubnetId ?? "") : `${item.SubnetId} (${label})`,
          value: item.SubnetId ?? "",
          description: `${item.CidrBlock ?? ""} · ${item.AvailabilityZone ?? ""} · ${item.VpcId ?? ""}`,
        };
      });
      setSubnets(options);
      setSubnet(options[0] ?? null);
    }

    if (addressResult.status === "fulfilled") {
      // AWS only offers addresses that are not already associated with something.
      const options = (addressResult.value.Addresses ?? [])
        .filter((item) => !item.AssociationId && !item.InstanceId && item.AllocationId)
        .map((item) => ({
          label: `${item.AllocationId} (${item.PublicIp})`,
          value: item.AllocationId ?? "",
        }));
      setAddresses(options);
      setAddress(options[0] ?? null);
    }
  }, [client]);

  useEffect(() => {
    if (visible) {
      setName("");
      setConnectivity("public");
      setTags([]);
      setFormError(null);
      void loadOptions();
    }
  }, [visible, loadOptions, setFormError]);

  const onSubmit = () => {
    if (subnet === null || !subnet.value) {
      setFormError("Choose the subnet to create the NAT gateway in.");
      return;
    }
    if (connectivity === "public" && (address === null || !address.value)) {
      setFormError(
        "A public NAT gateway needs an Elastic IP. Allocate one under Elastic IP addresses first, or choose private connectivity.",
      );
      return;
    }
    void submit(async () => {
      const created = await client.send(
        new CreateNatGatewayCommand({
          SubnetId: subnet.value,
          ConnectivityType: connectivity as "private" | "public",
          ...(connectivity === "public" ? { AllocationId: address?.value } : {}),
          TagSpecifications: tagSpecifications("natgateway", name, tags),
        }),
      );
      notify({
        type: "success",
        content: `NAT gateway ${created.NatGateway?.NatGatewayId} created in ${created.NatGateway?.SubnetId}.`,
      });
      await onCreated();
    });
  };

  return (
    <CreateModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Create NAT gateway"
      submitLabel="Create NAT gateway"
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
          placeholder="my-nat-gateway"
          onChange={(event) => setName(event.detail.value)}
        />
      </FormField>
      <FormField
        label="Subnet"
        description="Create the NAT gateway in a public subnet of the VPC whose private subnets need outbound access."
      >
        <Select
          selectedOption={subnet}
          options={subnets}
          placeholder={subnets.length === 0 ? "No subnets in this Region" : "Choose a subnet"}
          onChange={(event) => setSubnet(event.detail.selectedOption)}
        />
      </FormField>
      <FormField label="Connectivity type">
        <RadioGroup
          value={connectivity}
          onChange={(event) => setConnectivity(event.detail.value)}
          items={[
            {
              value: "public",
              label: "Public",
              description:
                "Instances in private subnets reach the internet, but cannot be reached from it.",
            },
            {
              value: "private",
              label: "Private",
              description: "Instances reach other VPCs or on-premises networks, never the internet.",
            },
          ]}
        />
      </FormField>
      {connectivity === "public" && (
        <FormField
          label="Elastic IP allocation ID"
          description="The public address traffic leaving the private subnets will appear to come from."
        >
          {addresses.length === 0 ? (
            <Box variant="p" color="text-status-inactive">
              No unassociated Elastic IP addresses in this Region. Allocate one under Elastic IP
              addresses, then return here.
            </Box>
          ) : (
            <Select
              selectedOption={address}
              options={addresses}
              placeholder="Choose an Elastic IP"
              onChange={(event) => setAddress(event.detail.selectedOption)}
            />
          )}
        </FormField>
      )}
      <FormField label="Tags">
        <KeyValueEditor
          items={tags}
          onChange={setTags}
          keyLabel="Key"
          valueLabel="Value"
          addLabel="Add new tag"
          empty="No tags associated with this NAT gateway."
        />
      </FormField>
    </CreateModalShell>
  );
}
