import { useParams } from "react-router-dom";

import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { NotFoundPage } from "@shell/NotFoundPage";
import { EC2_API_RESOURCES } from "./resources";
import { ResourceTablePage } from "./resourceTable";

/**
 * `/ec2/:resource` — the EC2 console's inventory tables.
 *
 * The table itself is `ResourceTablePage`, shared with the VPC console; this component
 * only resolves the route segment to a definition and supplies EC2's breadcrumbs.
 *
 * Resources in the VPC domain (VPCs, subnets, route tables, internet gateways) still
 * resolve here so older links keep working, but they are reached from the VPC console
 * now — the EC2 nav no longer lists them, matching AWS.
 */
export default function ResourceListPage() {
  const { resource = "" } = useParams();
  const definition = EC2_API_RESOURCES[resource];

  useBreadcrumbs(
    definition
      ? [
          { text: "EC2", href: "/ec2" },
          { text: definition.title, href: `/ec2/${resource}` },
        ]
      : [],
  );

  if (!definition) {
    return <NotFoundPage />;
  }

  return <ResourceTablePage definition={definition} resourceKey={`ec2/${resource}`} />;
}
