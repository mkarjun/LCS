import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ListRolesCommand } from "@aws-sdk/client-iam";
import type { Role } from "@aws-sdk/client-iam";
import Link from "@cloudscape-design/components/link";

import { IamListPage } from "./IamListPage";
import { CreateRoleModal } from "./CreateRoleModal";
import { dash, formatIamDate, trustedEntities, useIamClient } from "./useIamClient";

export default function RolesPage() {
  const navigate = useNavigate();
  const client = useIamClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(
    async (): Promise<Role[]> => (await client.send(new ListRolesCommand({}))).Roles ?? [],
    [client],
  );

  return (
    <IamListPage<Role>
      title="Roles"
      description="An IAM role is an identity you can create that has specific permissions with credentials that are valid for short durations."
      filterPlaceholder="Search"
      emptyTitle="No roles"
      emptyText="Create a role to delegate access to users, applications, or services."
      crumbs={[
        { text: "IAM", href: "/iam" },
        { text: "Roles", href: "/iam/roles" },
      ]}
      trackBy={(role) => role.RoleName ?? ""}
      load={load}
      reloadToken={reloadToken}
      primaryAction={{ label: "Create role", onClick: () => setCreateOpen(true) }}
      columns={[
        {
          id: "roleName",
          header: "Role name",
          isRowHeader: true,
          cell: (role) => (
            <Link
              href={`/iam/roles/${role.RoleName}`}
              onFollow={(event) => {
                event.preventDefault();
                navigate(`/iam/roles/${role.RoleName}`);
              }}
            >
              {role.RoleName}
            </Link>
          ),
        },
        {
          id: "trusted",
          header: "Trusted entities",
          cell: (role) => trustedEntities(role.AssumeRolePolicyDocument),
        },
        { id: "path", header: "Path", cell: (role) => dash(role.Path) },
        { id: "created", header: "Creation time", cell: (role) => formatIamDate(role.CreateDate) },
      ]}
    >
      <CreateRoleModal
        visible={createOpen}
        onDismiss={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          setReloadToken((token) => token + 1);
        }}
      />
    </IamListPage>
  );
}
