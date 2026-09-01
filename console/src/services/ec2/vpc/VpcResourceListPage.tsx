import { useParams } from "react-router-dom";

import { useBreadcrumbs } from "@shell/BreadcrumbContext";
import { NotFoundPage } from "@shell/NotFoundPage";
import { ResourceTablePage } from "../resourceTable";
import { VPC_RESOURCES } from "./vpcResources";

/**
 * `/vpc/:resource` — the VPC console's inventory tables.
 *
 * The table is `ResourceTablePage`, shared with the EC2 console; this component only
 * resolves the route segment to a definition and supplies the VPC breadcrumbs.
 */
export default function VpcResourceListPage() {
  const { resource = "" } = useParams();
  const definition = VPC_RESOURCES[resource];

  useBreadcrumbs(
    definition
      ? [
          { text: "VPC", href: "/vpc" },
          { text: definition.title, href: `/vpc/${resource}` },
        ]
      : [],
  );

  if (!definition) {
    return <NotFoundPage />;
  }

  return <ResourceTablePage definition={definition} resourceKey={`vpc/${resource}`} />;
}
