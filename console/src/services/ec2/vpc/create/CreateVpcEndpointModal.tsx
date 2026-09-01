import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CreateVpcEndpointCommand,
  DescribeRouteTablesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
} from "@aws-sdk/client-ec2";
import Autosuggest from "@cloudscape-design/components/autosuggest";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Multiselect from "@cloudscape-design/components/multiselect";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Select from "@cloudscape-design/components/select";
import type { SelectProps } from "@cloudscape-design/components/select";
import Toggle from "@cloudscape-design/components/toggle";

import { useEmulator } from "@platform/EmulatorContext";
import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { useNotifications } from "@shell/NotificationContext";
import { nameTag, useEc2Client } from "../../useEc2Client";
import { CreateModalShell } from "../../create/CreateModalShell";
import { loadVpcOptions, tagSpecifications, useCreateForm } from "../../create/createForm";
import type { Ec2CreateModalProps } from "../../create/createForm";

/**
 * AWS's "Create endpoint" form, narrowed to the AWS-services category.
 *
 * AWS fills the service field from `DescribeVpcEndpointServices`. LCS answers that call
 * with an empty list, so the field is an autosuggest seeded from the services this
 * emulator build actually has enabled — `com.amazonaws.<region>.<service>` — while still
 * accepting any name typed in. That keeps the field useful without inventing a catalog
 * the emulator cannot back.
 *
 * AWS also infers Gateway vs Interface from the chosen service. Without a service catalog
 * there is nothing to infer from, so the type is an explicit choice here.
 */
export function CreateVpcEndpointModal({ visible, onDismiss, onCreated }: Ec2CreateModalProps) {
  const client = useEc2Client();
  const { notify } = useNotifications();
  const { summary, region } = useEmulator();
  const { formError, setFormError, submitting, submit } = useCreateForm();

  const [name, setName] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [endpointType, setEndpointType] = useState("Gateway");
  const [vpcs, setVpcs] = useState<SelectProps.Option[]>([]);
  const [vpc, setVpc] = useState<SelectProps.Option | null>(null);
  const [routeTables, setRouteTables] = useState<SelectProps.Option[]>([]);
  const [selectedRouteTables, setSelectedRouteTables] = useState<readonly SelectProps.Option[]>([]);
  const [subnets, setSubnets] = useState<SelectProps.Option[]>([]);
  const [selectedSubnets, setSelectedSubnets] = useState<readonly SelectProps.Option[]>([]);
  const [groups, setGroups] = useState<SelectProps.Option[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<readonly SelectProps.Option[]>([]);
  const [privateDns, setPrivateDns] = useState(true);
  const [tags, setTags] = useState<KeyValuePair[]>([]);

  const serviceSuggestions = useMemo(
    () =>
      (summary?.services ?? [])
        .filter((service) => service.enabled)
        .map((service) => ({ value: `com.amazonaws.${region}.${service.id}` }))
        .sort((left, right) => left.value.localeCompare(right.value)),
    [summary, region],
  );

  const vpcId = vpc?.value ?? "";

  const loadVpcs = useCallback(async () => {
    try {
      const options = await loadVpcOptions(client);
      setVpcs(options);
      setVpc(options[0] ?? null);
    } catch {
      setVpcs([]);
    }
  }, [client]);

  // Route tables, subnets, and security groups are all VPC-scoped, so they reload
  // whenever the chosen VPC changes and any selection made against the old one is dropped.
  const loadVpcScoped = useCallback(async () => {
    if (vpcId === "") {
      setRouteTables([]);
      setSubnets([]);
      setGroups([]);
      return;
    }
    const filters = [{ Name: "vpc-id", Values: [vpcId] }];
    const [tableResult, subnetResult, groupResult] = await Promise.allSettled([
      client.send(new DescribeRouteTablesCommand({ Filters: filters })),
      client.send(new DescribeSubnetsCommand({ Filters: filters })),
      client.send(new DescribeSecurityGroupsCommand({ Filters: filters })),
    ]);

    setRouteTables(
      tableResult.status === "fulfilled"
        ? (tableResult.value.RouteTables ?? []).map((table) => ({
            label: table.RouteTableId ?? "",
            value: table.RouteTableId ?? "",
            description: nameTag(table.Tags) === "—" ? undefined : nameTag(table.Tags),
          }))
        : [],
    );
    setSubnets(
      subnetResult.status === "fulfilled"
        ? (subnetResult.value.Subnets ?? []).map((subnet) => ({
            label: subnet.SubnetId ?? "",
            value: subnet.SubnetId ?? "",
            description: `${subnet.CidrBlock ?? ""} · ${subnet.AvailabilityZone ?? ""}`,
          }))
        : [],
    );
    setGroups(
      groupResult.status === "fulfilled"
        ? (groupResult.value.SecurityGroups ?? []).map((group) => ({
            label: `${group.GroupId} (${group.GroupName})`,
            value: group.GroupId ?? "",
          }))
        : [],
    );
    setSelectedRouteTables([]);
    setSelectedSubnets([]);
    setSelectedGroups([]);
  }, [client, vpcId]);

  useEffect(() => {
    if (visible) {
      setName("");
      setServiceName("");
      setEndpointType("Gateway");
      setPrivateDns(true);
      setTags([]);
      setFormError(null);
      void loadVpcs();
    }
  }, [visible, loadVpcs, setFormError]);

  useEffect(() => {
    if (visible) {
      void loadVpcScoped();
    }
  }, [visible, loadVpcScoped]);

  const onSubmit = () => {
    if (serviceName.trim() === "") {
      setFormError("Enter the service name to connect to, for example com.amazonaws.us-east-1.s3.");
      return;
    }
    if (vpc === null || !vpc.value) {
      setFormError("Choose the VPC to create the endpoint in.");
      return;
    }
    if (endpointType === "Gateway" && selectedRouteTables.length === 0) {
      setFormError("A gateway endpoint needs at least one route table.");
      return;
    }
    if (endpointType === "Interface" && selectedSubnets.length === 0) {
      setFormError("An interface endpoint needs at least one subnet.");
      return;
    }
    void submit(async () => {
      const gateway = endpointType === "Gateway";
      const created = await client.send(
        new CreateVpcEndpointCommand({
          VpcId: vpc.value,
          ServiceName: serviceName.trim(),
          VpcEndpointType: endpointType as "Gateway" | "Interface",
          ...(gateway
            ? { RouteTableIds: selectedRouteTables.map((option) => option.value ?? "") }
            : {
                SubnetIds: selectedSubnets.map((option) => option.value ?? ""),
                SecurityGroupIds: selectedGroups.map((option) => option.value ?? ""),
                PrivateDnsEnabled: privateDns,
              }),
          TagSpecifications: tagSpecifications("vpc-endpoint", name, tags),
        }),
      );
      notify({
        type: "success",
        content: `Endpoint ${created.VpcEndpoint?.VpcEndpointId} created for ${created.VpcEndpoint?.ServiceName}.`,
      });
      await onCreated();
    });
  };

  return (
    <CreateModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Create endpoint"
      submitLabel="Create endpoint"
      onSubmit={onSubmit}
      submitting={submitting}
      formError={formError}
      size="large"
    >
      <FormField
        label="Name"
        description="Creates a tag with a key of 'Name' and the value you specify."
      >
        <Input
          value={name}
          autoFocus
          placeholder="my-endpoint"
          onChange={(event) => setName(event.detail.value)}
        />
      </FormField>
      <FormField
        label="Service name"
        description="Suggestions come from the services this LCS build has enabled. Any service name is accepted."
      >
        <Autosuggest
          value={serviceName}
          options={serviceSuggestions}
          placeholder={`com.amazonaws.${region}.s3`}
          enteredTextLabel={(value) => `Use "${value}"`}
          empty="No enabled services to suggest"
          onChange={(event) => setServiceName(event.detail.value)}
        />
      </FormField>
      <FormField
        label="Type"
        description="In AWS, S3 and DynamoDB are reached through gateway endpoints; every other service uses an interface endpoint."
      >
        <RadioGroup
          value={endpointType}
          onChange={(event) => setEndpointType(event.detail.value)}
          items={[
            {
              value: "Gateway",
              label: "Gateway",
              description: "Adds a route to the route tables you choose. No addresses are used.",
            },
            {
              value: "Interface",
              label: "Interface",
              description: "Places an elastic network interface in each subnet you choose.",
            },
          ]}
        />
      </FormField>
      <FormField label="VPC">
        <Select
          selectedOption={vpc}
          options={vpcs}
          placeholder={vpcs.length === 0 ? "No VPCs in this Region" : "Choose a VPC"}
          onChange={(event) => setVpc(event.detail.selectedOption)}
        />
      </FormField>
      {endpointType === "Gateway" ? (
        <FormField
          label="Route tables"
          description="A route to the service is added to each table you select."
        >
          <Multiselect
            selectedOptions={selectedRouteTables}
            options={routeTables}
            placeholder={
              routeTables.length === 0 ? "No route tables in this VPC" : "Choose route tables"
            }
            onChange={(event) => setSelectedRouteTables(event.detail.selectedOptions)}
          />
        </FormField>
      ) : (
        <>
          <FormField
            label="Subnets"
            description="One network interface is placed in each subnet you select."
          >
            <Multiselect
              selectedOptions={selectedSubnets}
              options={subnets}
              placeholder={subnets.length === 0 ? "No subnets in this VPC" : "Choose subnets"}
              onChange={(event) => setSelectedSubnets(event.detail.selectedOptions)}
            />
          </FormField>
          <FormField
            label="Security groups"
            description="Controls which resources may reach the endpoint's network interfaces."
          >
            <Multiselect
              selectedOptions={selectedGroups}
              options={groups}
              placeholder={
                groups.length === 0 ? "No security groups in this VPC" : "Choose security groups"
              }
              onChange={(event) => setSelectedGroups(event.detail.selectedOptions)}
            />
          </FormField>
          <FormField label="Additional settings">
            <Toggle
              checked={privateDns}
              onChange={(event) => setPrivateDns(event.detail.checked)}
            >
              Enable DNS name
            </Toggle>
          </FormField>
        </>
      )}
      <FormField label="Tags">
        <KeyValueEditor
          items={tags}
          onChange={setTags}
          keyLabel="Key"
          valueLabel="Value"
          addLabel="Add new tag"
          empty="No tags associated with this endpoint."
        />
      </FormField>
    </CreateModalShell>
  );
}
