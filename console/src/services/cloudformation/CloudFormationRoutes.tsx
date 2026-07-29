import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { recordVisit } from "@shell/recentlyVisited";
import { unavailableNavItem } from "@shell/navUnavailable";
import { useServiceNav } from "@shell/ServiceNavContext";
import StacksPage from "./StacksPage";
import StackDetailPage from "./StackDetailPage";
import StackSetsPage from "./StackSetsPage";
import ExportsPage from "./ExportsPage";

/**
 * CloudFormation routes and left navigation.
 *
 * Stacks is the landing page, matching AWS. Entries LCS cannot back are greyed rather
 * than dropped so the rail keeps the shape of the AWS nav; each has a matching line in the
 * completeness backlog in planning/product-execution-plan.md.
 */
export default function CloudFormationRoutes() {
  useEffect(() => recordVisit("cloudformation"), []);

  useServiceNav({
    title: "CloudFormation",
    href: "/cloudformation",
    items: [
      { type: "link", text: "Stacks", href: "/cloudformation" },
      unavailableNavItem("Stack refactors", "CreateStackRefactor is not implemented"),
      { type: "link", text: "StackSets", href: "/cloudformation/stacksets" },
      { type: "link", text: "Exports", href: "/cloudformation/exports" },
      { type: "divider" },
      unavailableNavItem("Infrastructure Composer", "the visual template builder is console-only"),
      unavailableNavItem("IaC generator", "no resource-scanning API is implemented"),
      { type: "divider" },
      unavailableNavItem("Hooks overview", "the Hooks APIs are not implemented"),
      unavailableNavItem("Invocation summary", "the Hooks APIs are not implemented"),
      unavailableNavItem("Hooks", "the Hooks APIs are not implemented"),
      { type: "divider" },
      {
        type: "section",
        text: "Registry",
        defaultExpanded: true,
        items: [
          unavailableNavItem("Public extensions", "the CloudFormation registry is not implemented"),
          unavailableNavItem("Activated extensions", "the CloudFormation registry is not implemented"),
          unavailableNavItem("Publisher", "the CloudFormation registry is not implemented"),
        ],
      },
      { type: "divider" },
      unavailableNavItem("Spotlight", "an AWS console feature with no API behind it"),
    ],
  });

  return (
    <Routes>
      <Route index element={<StacksPage />} />
      <Route path="stacks/:stackName" element={<StackDetailPage />} />
      <Route path="stacksets" element={<StackSetsPage />} />
      <Route path="exports" element={<ExportsPage />} />
    </Routes>
  );
}
