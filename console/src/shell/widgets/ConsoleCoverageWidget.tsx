import { useNavigate } from "react-router-dom";
import Box from "@cloudscape-design/components/box";
import Link from "@cloudscape-design/components/link";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { SERVICE_CATALOG } from "@services/catalog";
import { implementedCount } from "@services/registry";

export function ConsoleCoverageWidget() {
  const navigate = useNavigate();
  const built = implementedCount();
  const total = SERVICE_CATALOG.length;

  return (
    <SpaceBetween size="m">
      <ProgressBar
        value={(built / total) * 100}
        additionalInfo={`${built} of ${total} services have a console surface`}
        description="Remaining services are emulated and reachable through the AWS CLI and SDKs."
        label="Console surfaces built"
      />
      <Box>
        <Link
          href="/services"
          onFollow={(event) => {
            event.preventDefault();
            navigate("/services");
          }}
        >
          View all services
        </Link>
      </Box>
    </SpaceBetween>
  );
}
