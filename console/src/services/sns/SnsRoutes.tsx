import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { recordVisit } from "@shell/recentlyVisited";
import { useServiceNav } from "@shell/ServiceNavContext";
import TopicsPage from "./TopicsPage";
import TopicDetailPage from "./TopicDetailPage";
import SubscriptionsPage from "./SubscriptionsPage";

/**
 * SNS routes and navigation.
 *
 * Mobile push, text messaging (SMS), and origination numbers are omitted — no backend.
 */
export default function SnsRoutes() {
  useEffect(() => recordVisit("sns"), []);

  useServiceNav({
    title: "Amazon SNS",
    href: "/sns",
    items: [
      { type: "link", text: "Topics", href: "/sns" },
      { type: "link", text: "Subscriptions", href: "/sns/subscriptions" },
    ],
  });

  return (
    <Routes>
      <Route index element={<TopicsPage />} />
      {/* ARNs contain colons and slashes, so the topic name is the route key. */}
      <Route path="topics/:topicName" element={<TopicDetailPage />} />
      <Route path="subscriptions" element={<SubscriptionsPage />} />
    </Routes>
  );
}
