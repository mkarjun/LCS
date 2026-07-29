import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { recordVisit } from "@shell/recentlyVisited";
import { useServiceNav } from "@shell/ServiceNavContext";
import LogGroupsPage from "./LogGroupsPage";
import LogGroupDetailPage from "./LogGroupDetailPage";
import LogEventsPage from "./LogEventsPage";
import AlarmsPage from "./AlarmsPage";
import MetricsPage from "./MetricsPage";

/**
 * CloudWatch routes and navigation.
 *
 * AWS presents Logs, Metrics, and Alarms as one CloudWatch console even though they are
 * distinct APIs (`logs` and `monitoring` in the emulator's catalog). This module covers
 * both, and the catalog registers each id against it so either entry point lands here.
 *
 * Dashboards are omitted: ListDashboards returns UnsupportedOperation. Application
 * Signals, GenAI Observability, Network Monitoring, and Log Anomalies have no backend
 * here either, so they are left out rather than shown as dead nav items.
 */
export default function CloudWatchRoutes() {
  useEffect(() => recordVisit("cloudwatch"), []);

  useServiceNav({
    title: "CloudWatch",
    href: "/cloudwatch",
    items: [
      { type: "link", text: "Alarms", href: "/cloudwatch/alarms" },
      {
        type: "section",
        text: "Logs",
        defaultExpanded: true,
        items: [{ type: "link", text: "Log groups", href: "/cloudwatch" }],
      },
      {
        type: "section",
        text: "Metrics",
        defaultExpanded: true,
        items: [{ type: "link", text: "All metrics", href: "/cloudwatch/metrics" }],
      },
    ],
  });

  return (
    <Routes>
      <Route index element={<LogGroupsPage />} />
      {/* Log group names contain slashes, so the wildcard captures the whole remainder. */}
      <Route path="log-groups/streams/*" element={<LogEventsPage />} />
      <Route path="log-groups/*" element={<LogGroupDetailPage />} />
      <Route path="alarms" element={<AlarmsPage />} />
      <Route path="metrics" element={<MetricsPage />} />
    </Routes>
  );
}
