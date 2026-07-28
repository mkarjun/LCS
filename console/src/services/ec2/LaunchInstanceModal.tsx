import { useCallback, useEffect, useState } from "react";
import {
  DescribeImagesCommand,
  DescribeKeyPairsCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  RunInstancesCommand,
} from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { SelectProps } from "@cloudscape-design/components/select";

import { describeAwsError } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";
import { useEc2Client } from "./useEc2Client";

interface LaunchInstanceModalProps {
  visible: boolean;
  onDismiss: () => void;
  onLaunched: () => Promise<void>;
}

/** Instance types the AWS launch wizard offers first for general-purpose workloads. */
const INSTANCE_TYPES = ["t2.micro", "t3.micro", "t3.small", "t3.medium", "t3.large", "m5.large"];

const NONE: SelectProps.Option = { label: "None", value: "" };

export function LaunchInstanceModal({ visible, onDismiss, onLaunched }: LaunchInstanceModalProps) {
  const client = useEc2Client();
  const { notify } = useNotifications();

  const [name, setName] = useState("");
  const [count, setCount] = useState("1");
  const [amis, setAmis] = useState<SelectProps.Option[]>([]);
  const [keyPairs, setKeyPairs] = useState<SelectProps.Option[]>([NONE]);
  const [subnets, setSubnets] = useState<SelectProps.Option[]>([NONE]);
  const [groups, setGroups] = useState<SelectProps.Option[]>([NONE]);
  const [ami, setAmi] = useState<SelectProps.Option | null>(null);
  const [instanceType, setInstanceType] = useState<SelectProps.Option>({
    label: "t3.micro",
    value: "t3.micro",
  });
  const [keyPair, setKeyPair] = useState<SelectProps.Option>(NONE);
  const [subnet, setSubnet] = useState<SelectProps.Option>(NONE);
  const [group, setGroup] = useState<SelectProps.Option>(NONE);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadOptions = useCallback(async () => {
    const [imageResult, keyResult, subnetResult, groupResult] = await Promise.allSettled([
      client.send(new DescribeImagesCommand({})),
      client.send(new DescribeKeyPairsCommand({})),
      client.send(new DescribeSubnetsCommand({})),
      client.send(new DescribeSecurityGroupsCommand({})),
    ]);

    if (imageResult.status === "fulfilled") {
      const options = (imageResult.value.Images ?? []).map((image) => ({
        label: image.Name ?? image.ImageId ?? "",
        value: image.ImageId ?? "",
        description: image.Description,
      }));
      setAmis(options);
      setAmi(options[0] ?? null);
    }
    if (keyResult.status === "fulfilled") {
      setKeyPairs([
        NONE,
        ...(keyResult.value.KeyPairs ?? []).map((k) => ({
          label: k.KeyName ?? "",
          value: k.KeyName ?? "",
        })),
      ]);
    }
    if (subnetResult.status === "fulfilled") {
      setSubnets([
        NONE,
        ...(subnetResult.value.Subnets ?? []).map((s) => ({
          label: `${s.SubnetId} (${s.AvailabilityZone})`,
          value: s.SubnetId ?? "",
        })),
      ]);
    }
    if (groupResult.status === "fulfilled") {
      setGroups([
        NONE,
        ...(groupResult.value.SecurityGroups ?? []).map((g) => ({
          label: `${g.GroupName} (${g.GroupId})`,
          value: g.GroupId ?? "",
        })),
      ]);
    }
  }, [client]);

  useEffect(() => {
    if (visible) {
      setName("");
      setCount("1");
      setFormError(null);
      void loadOptions();
    }
  }, [visible, loadOptions]);

  const submit = async () => {
    if (ami === null || !ami.value) {
      setFormError("Select an Amazon Machine Image.");
      return;
    }
    const parsedCount = Number.parseInt(count, 10);
    if (!Number.isFinite(parsedCount) || parsedCount < 1) {
      setFormError("Number of instances must be at least 1.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await client.send(
        new RunInstancesCommand({
          ImageId: ami.value,
          InstanceType: instanceType.value as never,
          MinCount: parsedCount,
          MaxCount: parsedCount,
          ...(keyPair.value ? { KeyName: keyPair.value } : {}),
          ...(subnet.value ? { SubnetId: subnet.value } : {}),
          ...(group.value ? { SecurityGroupIds: [group.value] } : {}),
          ...(name.trim()
            ? {
                TagSpecifications: [
                  {
                    ResourceType: "instance",
                    Tags: [{ Key: "Name", Value: name.trim() }],
                  },
                ],
              }
            : {}),
        }),
      );
      notify({
        type: "success",
        content: `Successfully initiated launch of ${parsedCount} instance${parsedCount === 1 ? "" : "s"}.`,
      });
      await onLaunched();
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
      header="Launch an instance"
      size="medium"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Launch instance
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <FormField
            label="Name and tags"
            description="Creates a tag with a key of 'Name' and the value you specify."
          >
            <Input
              value={name}
              placeholder="e.g. web-server"
              onChange={(event) => setName(event.detail.value)}
            />
          </FormField>
          <FormField
            label="Application and OS Images (Amazon Machine Image)"
            description="An AMI is a template that contains the software configuration required to launch your instance."
          >
            <Select
              selectedOption={ami}
              options={amis}
              placeholder="Choose an AMI"
              onChange={(event) => setAmi(event.detail.selectedOption)}
            />
          </FormField>
          <FormField label="Instance type">
            <Select
              selectedOption={instanceType}
              options={INSTANCE_TYPES.map((type) => ({ label: type, value: type }))}
              onChange={(event) => setInstanceType(event.detail.selectedOption)}
            />
          </FormField>
          <FormField
            label="Key pair (login)"
            description="A key pair lets you connect to your instance securely."
          >
            <Select
              selectedOption={keyPair}
              options={keyPairs}
              onChange={(event) => setKeyPair(event.detail.selectedOption)}
            />
          </FormField>
          <FormField label="Subnet">
            <Select
              selectedOption={subnet}
              options={subnets}
              onChange={(event) => setSubnet(event.detail.selectedOption)}
            />
          </FormField>
          <FormField label="Security group">
            <Select
              selectedOption={group}
              options={groups}
              onChange={(event) => setGroup(event.detail.selectedOption)}
            />
          </FormField>
          <FormField label="Number of instances">
            <Input
              value={count}
              type="number"
              inputMode="numeric"
              onChange={(event) => setCount(event.detail.value)}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
