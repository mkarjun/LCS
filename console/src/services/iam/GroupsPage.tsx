import { useCallback, useState } from "react";
import { GetGroupCommand, ListGroupsCommand } from "@aws-sdk/client-iam";
import type { Group } from "@aws-sdk/client-iam";

import { IamListPage } from "./IamListPage";
import { CreateGroupModal } from "./CreateGroupModal";
import { dash, formatIamDate, useIamClient } from "./useIamClient";

interface GroupRow extends Group {
  userCount?: number;
}

export default function GroupsPage() {
  const client = useIamClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async (): Promise<GroupRow[]> => {
    const groups = (await client.send(new ListGroupsCommand({}))).Groups ?? [];
    // AWS shows the member count, which ListGroups does not return.
    return Promise.all(
      groups.map(async (group) => {
        try {
          const detail = await client.send(new GetGroupCommand({ GroupName: group.GroupName }));
          return { ...group, userCount: (detail.Users ?? []).length };
        } catch {
          return { ...group, userCount: undefined };
        }
      }),
    );
  }, [client]);

  return (
    <IamListPage<GroupRow>
      title="User groups"
      description="A user group is a collection of IAM users. Use groups to specify permissions for a collection of users."
      filterPlaceholder="Search"
      emptyTitle="No user groups"
      emptyText="Create a user group to manage permissions for several users at once."
      crumbs={[
        { text: "IAM", href: "/iam" },
        { text: "User groups", href: "/iam/groups" },
      ]}
      trackBy={(group) => group.GroupName ?? ""}
      load={load}
      reloadToken={reloadToken}
      primaryAction={{ label: "Create group", onClick: () => setCreateOpen(true) }}
      columns={[
        {
          id: "groupName",
          header: "Group name",
          cell: (group) => group.GroupName ?? "-",
          isRowHeader: true,
        },
        {
          id: "users",
          header: "Users",
          cell: (group) => (group.userCount === undefined ? "—" : String(group.userCount)),
        },
        { id: "path", header: "Path", cell: (group) => dash(group.Path) },
        { id: "created", header: "Creation time", cell: (group) => formatIamDate(group.CreateDate) },
      ]}
    >
      <CreateGroupModal
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
