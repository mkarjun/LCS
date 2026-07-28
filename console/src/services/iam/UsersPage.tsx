import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ListUsersCommand, ListGroupsForUserCommand } from "@aws-sdk/client-iam";
import type { User } from "@aws-sdk/client-iam";
import Link from "@cloudscape-design/components/link";

import { IamListPage } from "./IamListPage";
import { CreateUserModal } from "./CreateUserModal";
import { dash, formatIamDate, useIamClient } from "./useIamClient";

interface UserRow extends User {
  groupNames?: string[];
}

export default function UsersPage() {
  const navigate = useNavigate();
  const client = useIamClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async (): Promise<UserRow[]> => {
    const response = await client.send(new ListUsersCommand({}));
    const users = response.Users ?? [];

    // AWS shows group membership in the Users table, which ListUsers does not return.
    // Resolved per user and best-effort: one failure must not blank the table.
    return Promise.all(
      users.map(async (user) => {
        try {
          const groups = await client.send(
            new ListGroupsForUserCommand({ UserName: user.UserName }),
          );
          return {
            ...user,
            groupNames: (groups.Groups ?? []).map((group) => group.GroupName ?? ""),
          };
        } catch {
          return { ...user, groupNames: undefined };
        }
      }),
    );
  }, [client]);

  return (
    <IamListPage<UserRow>
      title="Users"
      description="An IAM user is an identity with long-term credentials that is used to interact with AWS in an account."
      filterPlaceholder="Search"
      emptyTitle="No users"
      emptyText="Create a user to grant long-term access to this account."
      crumbs={[
        { text: "IAM", href: "/iam" },
        { text: "Users", href: "/iam" },
      ]}
      trackBy={(user) => user.UserName ?? ""}
      load={load}
      reloadToken={reloadToken}
      primaryAction={{ label: "Create user", onClick: () => setCreateOpen(true) }}
      columns={[
        {
          id: "userName",
          header: "User name",
          isRowHeader: true,
          cell: (user) => (
            <Link
              href={`/iam/users/${user.UserName}`}
              onFollow={(event) => {
                event.preventDefault();
                navigate(`/iam/users/${user.UserName}`);
              }}
            >
              {user.UserName}
            </Link>
          ),
        },
        { id: "path", header: "Path", cell: (user) => dash(user.Path) },
        {
          id: "groups",
          header: "Groups",
          cell: (user) =>
            user.groupNames === undefined
              ? "—"
              : user.groupNames.length === 0
                ? "None"
                : user.groupNames.join(", "),
        },
        {
          id: "lastActivity",
          header: "Last activity",
          cell: (user) => formatIamDate(user.PasswordLastUsed),
        },
        { id: "created", header: "Creation time", cell: (user) => formatIamDate(user.CreateDate) },
      ]}
    >
      <CreateUserModal
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
