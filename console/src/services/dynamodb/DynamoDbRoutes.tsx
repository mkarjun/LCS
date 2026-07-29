import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { recordVisit } from "@shell/recentlyVisited";
import { useServiceNav } from "@shell/ServiceNavContext";
import DashboardPage from "./DashboardPage";
import TablesPage from "./TablesPage";
import TableDetailPage from "./TableDetailPage";

/**
 * DynamoDB routes and navigation.
 *
 * The landing page is the Dashboard, matching AWS — Tables is a separate nav entry, not
 * the service root.
 *
 * PartiQL editor, Backups, Exports/Imports to S3, Integrations, Reserved capacity, and
 * the whole DAX section are omitted: no backend for them here.
 */
export default function DynamoDbRoutes() {
  useEffect(() => recordVisit("dynamodb"), []);

  useServiceNav({
    title: "DynamoDB",
    href: "/dynamodb",
    items: [
      { type: "link", text: "Dashboard", href: "/dynamodb" },
      { type: "link", text: "Tables", href: "/dynamodb/tables" },
      { type: "link", text: "Explore items", href: "/dynamodb/explore" },
    ],
  });

  return (
    <Routes>
      <Route index element={<DashboardPage />} />
      <Route path="tables" element={<TablesPage />} />
      <Route path="tables/:tableName" element={<TableDetailPage />} />
      {/* AWS's "Explore items" is the table list scoped to item browsing. */}
      <Route path="explore" element={<TablesPage exploreMode />} />
    </Routes>
  );
}
