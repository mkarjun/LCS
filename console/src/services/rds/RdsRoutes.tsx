import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { recordVisit } from "@shell/recentlyVisited";
import { unavailableNavItem } from "@shell/navUnavailable";
import { useServiceNav } from "@shell/ServiceNavContext";
import RdsDashboardPage from "./RdsDashboardPage";
import DatabasesPage from "./DatabasesPage";
import DatabaseDetailPage from "./DatabaseDetailPage";
import ClusterDetailPage from "./ClusterDetailPage";
import SubnetGroupsPage from "./SubnetGroupsPage";
import ParameterGroupsPage from "./ParameterGroupsPage";
import ParameterGroupDetailPage from "./ParameterGroupDetailPage";

/**
 * RDS routes and left navigation.
 *
 * The nav reproduces the AWS "Aurora and RDS" rail entry for entry, including the divider
 * groupings. Entries LCS cannot back are greyed rather than dropped, so the rail shows
 * both what AWS offers and what this emulator covers. Each greyed entry names the API it
 * needs, and has a matching line in the completeness backlog in
 * planning/product-execution-plan.md.
 */
export default function RdsRoutes() {
  useEffect(() => recordVisit("rds"), []);

  useServiceNav({
    title: "Aurora and RDS",
    href: "/rds",
    items: [
      { type: "link", text: "Dashboard", href: "/rds" },
      { type: "link", text: "Databases", href: "/rds/databases" },
      unavailableNavItem("Query editor", "the RDS Data API is a separate service here"),
      unavailableNavItem("Performance insights", "no performance metrics are collected"),
      unavailableNavItem("Snapshots", "CreateDBSnapshot is not implemented"),
      unavailableNavItem("Exports in Amazon S3", "StartExportTask is not implemented"),
      unavailableNavItem("Automated backups", "DescribeDBInstanceAutomatedBackups is not implemented"),
      unavailableNavItem("Reserved instances", "there is no billing model"),
      unavailableNavItem("Proxies", "CreateDBProxy is not implemented"),
      { type: "divider" },
      { type: "link", text: "Subnet groups", href: "/rds/subnet-groups" },
      { type: "link", text: "Parameter groups", href: "/rds/parameter-groups" },
      unavailableNavItem("Option groups", "CreateOptionGroup is not implemented"),
      unavailableNavItem("Custom engine versions", "CreateCustomDBEngineVersion is not implemented"),
      unavailableNavItem("Zero-ETL integrations", "CreateIntegration is not implemented"),
      { type: "divider" },
      unavailableNavItem("Events", "DescribeEvents is not implemented"),
      unavailableNavItem("Event subscriptions", "CreateEventSubscription is not implemented"),
      { type: "divider" },
      unavailableNavItem("Recommendations", "DescribeDBRecommendations is not implemented"),
      unavailableNavItem("Certificate update", "DescribeCertificates is not implemented"),
    ],
  });

  return (
    <Routes>
      <Route index element={<RdsDashboardPage />} />
      <Route path="databases" element={<DatabasesPage />} />
      {/* Clusters and instances share AWS's Databases list but have separate detail pages,
          because DescribeDBClusters and DescribeDBInstances return different shapes. */}
      <Route path="databases/:instanceId" element={<DatabaseDetailPage />} />
      <Route path="clusters/:clusterId" element={<ClusterDetailPage />} />
      <Route path="subnet-groups" element={<SubnetGroupsPage />} />
      <Route path="parameter-groups" element={<ParameterGroupsPage />} />
      <Route path="parameter-groups/:groupName" element={<ParameterGroupDetailPage />} />
    </Routes>
  );
}
