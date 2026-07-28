import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { recordVisit } from "@shell/recentlyVisited";
import { useServiceNav } from "@shell/ServiceNavContext";
import UsersPage from "./UsersPage";
import UserDetailPage from "./UserDetailPage";
import RolesPage from "./RolesPage";
import RoleDetailPage from "./RoleDetailPage";
import GroupsPage from "./GroupsPage";
import PoliciesPage from "./PoliciesPage";

/**
 * IAM routes and left navigation.
 *
 * Mirrors the AWS IAM console's "Access management" grouping. Identity providers,
 * Account settings, and the Access reports section are omitted — LCS does not implement
 * them, and GetAccountSummary and ListEntitiesForPolicy return UnsupportedOperation.
 */
export default function IamRoutes() {
  useEffect(() => recordVisit("iam"), []);

  useServiceNav({
    title: "Identity and Access Management (IAM)",
    href: "/iam",
    items: [
      {
        type: "section",
        text: "Access management",
        defaultExpanded: true,
        items: [
          { type: "link", text: "User groups", href: "/iam/groups" },
          { type: "link", text: "Users", href: "/iam" },
          { type: "link", text: "Roles", href: "/iam/roles" },
          { type: "link", text: "Policies", href: "/iam/policies" },
        ],
      },
    ],
  });

  return (
    <Routes>
      <Route index element={<UsersPage />} />
      <Route path="users/:userName" element={<UserDetailPage />} />
      <Route path="roles" element={<RolesPage />} />
      <Route path="roles/:roleName" element={<RoleDetailPage />} />
      <Route path="groups" element={<GroupsPage />} />
      <Route path="policies" element={<PoliciesPage />} />
    </Routes>
  );
}
