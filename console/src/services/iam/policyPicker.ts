import { ListPoliciesCommand } from "@aws-sdk/client-iam";
import type { IAMClient } from "@aws-sdk/client-iam";
import type { MultiselectProps } from "@cloudscape-design/components/multiselect";

/**
 * Options for the permission-policy picker AWS shows in its create-role, create-group and
 * add-permissions flows.
 *
 * Customer-managed policies come first because a user who just wrote one expects to find
 * it without scrolling past 50 AWS-managed entries; within each group the order is AWS's
 * own alphabetical listing.
 */
export async function loadPolicyOptions(
  client: IAMClient,
): Promise<MultiselectProps.Options> {
  const response = await client.send(new ListPoliciesCommand({ Scope: "All" }));
  const policies = response.Policies ?? [];
  const awsManaged = policies.filter((policy) => policy.Arn?.startsWith("arn:aws:iam::aws:"));
  const customerManaged = policies.filter(
    (policy) => !policy.Arn?.startsWith("arn:aws:iam::aws:"),
  );

  const toOption = (policy: (typeof policies)[number]) => ({
    label: policy.PolicyName ?? "",
    value: policy.Arn ?? "",
    description: policy.Description,
  });

  return [
    ...(customerManaged.length > 0
      ? [{ label: "Customer managed", options: customerManaged.map(toOption) }]
      : []),
    ...(awsManaged.length > 0
      ? [{ label: "AWS managed", options: awsManaged.map(toOption) }]
      : []),
  ];
}

/** IAM's documented name rule, shared by roles, groups and policies. */
export function validateIamName(name: string, label: string, maxLength: number): string | null {
  if (name === "") {
    return `${label} is required.`;
  }
  if (name.length > maxLength) {
    return `${label} can be up to ${maxLength} characters.`;
  }
  if (!/^[\w+=,.@-]+$/.test(name)) {
    return `${label} can use only alphanumeric characters and + = , . @ _ -`;
  }
  return null;
}

/** Rejects a policy document the API would reject, and reports where the JSON breaks. */
export function validatePolicyDocument(document: string): string | null {
  if (document.trim() === "") {
    return "Policy document is required.";
  }
  try {
    const parsed = JSON.parse(document) as { Statement?: unknown };
    if (parsed.Statement === undefined) {
      return "Policy document needs a Statement element.";
    }
    return null;
  } catch (cause) {
    return `Policy document is not valid JSON — ${(cause as Error).message}`;
  }
}
