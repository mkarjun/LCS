import { useCallback, useState } from "react";
import {
  DescribeAvailabilityZonesCommand,
  DescribeVpcsCommand,
  type EC2Client,
  type ResourceType,
  type TagSpecification,
} from "@aws-sdk/client-ec2";
import type { SelectProps } from "@cloudscape-design/components/select";

import { describeAwsError } from "@platform/awsClient";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { nameTag } from "../useEc2Client";

/**
 * Every EC2 create modal takes the same three props, so `ResourceListPage` can render
 * whichever one its resource definition names without knowing anything else about it.
 */
export interface Ec2CreateModalProps {
  visible: boolean;
  onDismiss: () => void;
  /** Reloads the table and closes the modal. */
  onCreated: () => Promise<void>;
}

/**
 * Submit state shared by the create modals: a form-level error banner and a spinner on
 * the primary button, with AWS errors mapped to the same wording the rest of the console
 * uses.
 */
export function useCreateForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async (action: () => Promise<void>) => {
    setSubmitting(true);
    setFormError(null);
    try {
      await action();
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFormError(`${title}: ${detail}`);
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { formError, setFormError, submitting, submit };
}

/**
 * Builds the `TagSpecifications` a create call carries.
 *
 * AWS's create forms all have a Name field above a free-form tag editor, and the Name
 * field is just the `Name` tag — so it is merged in here rather than sent separately.
 * Returns undefined when there is nothing to tag, because EC2 rejects an empty
 * specification.
 */
export function tagSpecifications(
  resourceType: ResourceType,
  name: string,
  tags: KeyValuePair[],
): TagSpecification[] | undefined {
  const entries = [
    ...(name.trim() === "" ? [] : [{ Key: "Name", Value: name.trim() }]),
    ...tags
      .filter((tag) => tag.key.trim() !== "")
      .map((tag) => ({ Key: tag.key.trim(), Value: tag.value })),
  ];
  // A later Name tag in the editor wins, matching how CreateTags treats duplicate keys.
  const deduped = [...new Map(entries.map((tag) => [tag.Key, tag])).values()];
  return deduped.length === 0
    ? undefined
    : [{ ResourceType: resourceType, Tags: deduped }];
}

/** AWS labels a VPC picker "vpc-abc123 (my-vpc)", falling back to the id alone. */
export async function loadVpcOptions(client: EC2Client): Promise<SelectProps.Option[]> {
  const response = await client.send(new DescribeVpcsCommand({}));
  return (response.Vpcs ?? []).map((vpc) => {
    const name = nameTag(vpc.Tags);
    return {
      label: name === "—" ? (vpc.VpcId ?? "") : `${vpc.VpcId} (${name})`,
      value: vpc.VpcId ?? "",
      description: vpc.CidrBlock,
    };
  });
}

export async function loadAvailabilityZoneOptions(
  client: EC2Client,
): Promise<SelectProps.Option[]> {
  const response = await client.send(new DescribeAvailabilityZonesCommand({}));
  return (response.AvailabilityZones ?? []).map((zone) => ({
    label: zone.ZoneName ?? "",
    value: zone.ZoneName ?? "",
    description: zone.ZoneId,
  }));
}
