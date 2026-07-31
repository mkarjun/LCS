import { useCallback, useState } from "react";
import { ListPoliciesCommand } from "@aws-sdk/client-iam";
import type { Policy } from "@aws-sdk/client-iam";
import Link from "@cloudscape-design/components/link";

import { IamListPage } from "./IamListPage";
import { CreatePolicyModal } from "./CreatePolicyModal";
import { PolicyDocumentModal } from "./PolicyDocumentModal";
import { dash, formatIamDate, useIamClient } from "./useIamClient";

export default function PoliciesPage() {
  const client = useIamClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [viewing, setViewing] = useState<Policy | null>(null);

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
      reloadToken={reloadToken}
      primaryAction={{ label: "Create policy", onClick: () => setCreateOpen(true) }}
      columns={[
        {
          id: "policyName",
          header: "Policy name",
          isRowHeader: true,
          // AWS drills into a policy page; the document is the part of it LCS can serve,
          // so the name opens the document rather than a page with one populated tab.
          cell: (policy) => (
            <Link
              href={`#${policy.Arn}`}
              onFollow={(event) => {
                event.preventDefault();
                setViewing(policy);
              }}
            >
              {policy.PolicyName}
            </Link>
          ),
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
    >
      <CreatePolicyModal
        visible={createOpen}
        onDismiss={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          setReloadToken((token) => token + 1);
        }}
      />
      {viewing !== null && (
        <PolicyDocumentModal
          visible
          onDismiss={() => setViewing(null)}
          policyArn={viewing.Arn ?? ""}
          policyName={viewing.PolicyName ?? ""}
        />
      )}
    </IamListPage>
  );
}
