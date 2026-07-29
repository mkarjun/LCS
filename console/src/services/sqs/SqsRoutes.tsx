import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { recordVisit } from "@shell/recentlyVisited";
import { useServiceNav } from "@shell/ServiceNavContext";
import QueuesPage from "./QueuesPage";
import QueueDetailPage from "./QueueDetailPage";

export default function SqsRoutes() {
  useEffect(() => recordVisit("sqs"), []);

  useServiceNav({
    title: "Amazon SQS",
    href: "/sqs",
    items: [{ type: "link", text: "Queues", href: "/sqs" }],
  });

  return (
    <Routes>
      <Route index element={<QueuesPage />} />
      {/* Queue names are a single segment, but the URL carries the name not the full URL. */}
      <Route path="queues/:queueName" element={<QueueDetailPage />} />
    </Routes>
  );
}
