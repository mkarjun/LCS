import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { recordVisit } from "@shell/recentlyVisited";
import { useServiceNav } from "@shell/ServiceNavContext";
import BucketsPage from "./BucketsPage";
import BucketDetailPage from "./BucketDetailPage";

/**
 * S3 owns its own routes and its own left navigation.
 *
 * The nav mirrors the AWS S3 console's structure. Entries AWS shows but LCS cannot back
 * (Directory/Table/Vector buckets, Access Points, Access Grants, Storage Lens, Batch
 * Operations) are deliberately omitted rather than rendered as dead links — an item that
 * always errors is worse than no item.
 */
export default function S3Routes() {
  useEffect(() => recordVisit("s3"), []);

  useServiceNav({
    title: "Amazon S3",
    href: "/s3",
    items: [
      {
        type: "section",
        text: "Buckets",
        defaultExpanded: true,
        items: [{ type: "link", text: "General purpose buckets", href: "/s3" }],
      },
    ],
  });

  return (
    <Routes>
      <Route index element={<BucketsPage />} />
      <Route path="buckets/:bucketName" element={<BucketDetailPage />} />
    </Routes>
  );
}
