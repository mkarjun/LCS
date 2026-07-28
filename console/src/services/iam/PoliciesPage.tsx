import { useCallback } from "react";
import { ListPoliciesCommand } from "@aws-sdk/client-iam";
import type { Policy } from "@aws-sdk/client-iam";

import { IamListPage } from "./IamListPage";
import { dash, formatIamDate, useIamClient } from "./useIamClient";

export default function PoliciesPage() {
  const client = useIamClient();

  const load = useCallback(
    async (): Promise<Policy[]> =>
      (await client.send(new ListPoliciesCommand({ Scope: "All" }))).Policies ?? [],
    [client],
  );

  return (
    <IamListPage<Policy>
      title="Policies"
      description="A policy is an object that, when associated with an identity or resource, defines their permissions."
      filterPlaceholder="Search"
      emptyTitle="No policies"
      emptyText="Create a policy to define permissions you can attach to users, groups, and roles."
      crumbs={[
        { text: "IAM", href: "/iam" },
        { text: "Policies", href: "/iam/policies" },
      ]}
      trackBy={(policy) => policy.Arn ?? ""}
      load={load}
      columns={[
        {
          id: "policyName",
          header: "Policy name",
          cell: (policy) => policy.PolicyName ?? "-",
          isRowHeader: true,
        },
        {
          id: "type",
          // AWS distinguishes its own managed policies from customer-created ones by
          // the account segment of the ARN: aws-managed policies carry "::aws:".
          header: "Type",
          cell: (policy) =>
            policy.Arn?.startsWith("arn:aws:iam::aws:") ? "AWS managed" : "Customer managed",
        },
        {
          id: "attachments",
          header: "Attachment count",
          cell: (policy) => String(policy.AttachmentCount ?? 0),
        },
        { id: "path", header: "Path", cell: (policy) => dash(policy.Path) },
        {
          id: "created",
          header: "Creation time",
          cell: (policy) => formatIamDate(policy.CreateDate),
        },
      ]}
    />
  );
}
