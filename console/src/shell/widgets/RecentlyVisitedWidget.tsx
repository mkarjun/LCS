import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@cloudscape-design/components/box";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { findByPath, servicePath } from "@services/catalog";
import { RECENTLY_VISITED_EVENT, readRecentlyVisited } from "../recentlyVisited";

export function RecentlyVisitedWidget() {
  const navigate = useNavigate();
  const [paths, setPaths] = useState<string[]>(readRecentlyVisited);

  const refresh = useCallback(() => setPaths(readRecentlyVisited()), []);

  useEffect(() => {
    window.addEventListener(RECENTLY_VISITED_EVENT, refresh);
    // `storage` fires when another tab records a visit.
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(RECENTLY_VISITED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  const entries = paths
    .map((path) => findByPath(path))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .slice(0, 8);

  if (entries.length === 0) {
    return (
      <Box color="text-body-secondary" padding={{ vertical: "s" }}>
        Services you visit will appear here.
      </Box>
    );
  }

  return (
    <SpaceBetween size="m">
      <ColumnLayout columns={2} borders="horizontal">
        {entries.map((entry) => (
          <div key={entry.id}>
            <Link
              href={`/${servicePath(entry)}`}
              onFollow={(event) => {
                event.preventDefault();
                navigate(`/${servicePath(entry)}`);
              }}
            >
              {entry.shortName}
            </Link>
          </div>
        ))}
      </ColumnLayout>
      <Link
        href="/services"
        onFollow={(event) => {
          event.preventDefault();
          navigate("/services");
        }}
      >
        View all services
      </Link>
    </SpaceBetween>
  );
}
