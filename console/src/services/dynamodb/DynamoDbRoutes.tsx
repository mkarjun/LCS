import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { recordVisit } from "@shell/recentlyVisited";
import { useServiceNav } from "@shell/ServiceNavContext";
import TablesPage from "./TablesPage";
import TableDetailPage from "./TableDetailPage";

/**
 * DynamoDB routes and navigation.
 *
 * Backups, exports, and reserved capacity are omitted — no backend for them here.
 */
export default function DynamoDbRoutes() {
  useEffect(() => recordVisit("dynamodb"), []);

  useServiceNav({
    title: "DynamoDB",
    href: "/dynamodb",
    items: [
      { type: "link", text: "Tables", href: "/dynamodb" },
      { type: "link", text: "Explore items", href: "/dynamodb?view=items" },
    ],
  });

  return (
    <Routes>
      <Route index element={<TablesPage />} />
      <Route path="tables/:tableName" element={<TableDetailPage />} />
    </Routes>
  );
}
