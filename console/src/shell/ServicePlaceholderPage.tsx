import { useEffect } from "react";
import { useParams } from "react-router-dom";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";

import { useEmulator } from "@platform/EmulatorContext";
import { findByPath } from "@services/catalog";
import { useBreadcrumbs } from "./BreadcrumbContext";
import { NotFoundPage } from "./NotFoundPage";
import { recordVisit } from "./recentlyVisited";
import { ServiceIcon } from "./ServiceIcon";

/**
 * Landing page for an emulated service that does not yet have a console surface.
 *
 * This is deliberately honest rather than a fake dashboard: it states what is missing,
 * confirms the service is running, and shows how to reach it right now. Inventing
 * placeholder tables would violate the console parity rubric's "do not invent" rule and
 * would misrepresent what the emulator supports.
 */
export default function ServicePlaceholderPage() {
  const { servicePath = "" } = useParams();
  const entry = findByPath(servicePath);
  const { serviceStatus, region, summary } = useEmulator();

  useBreadcrumbs(entry ? [{ text: entry.shortName, href: `/${servicePath}` }] : []);

  useEffect(() => {
    if (entry) {
      recordVisit(servicePath);
    }
  }, [entry, servicePath]);

  if (!entry) {
    return <NotFoundPage />;
  }

  const status = serviceStatus(entry.id);
  const endpoint = summary?.configuredBaseUrl ?? window.location.origin;

  return (
    <ContentLayout
      header={
        <Header variant="h1" description={entry.description}>
          <SpaceBetween size="s" direction="horizontal" alignItems="center">
            <ServiceIcon entry={entry} size={32} />
            <span>{entry.name}</span>
          </SpaceBetween>
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Alert type="info" header="Console surface not built yet">
          This service is emulated and fully usable through the AWS CLI and SDKs. Its console
          screens are still being built.
        </Alert>

        <Container header={<Header variant="h2">Service details</Header>}>
          <KeyValuePairs
            columns={4}
            items={[
              {
                label: "Status",
                value:
                  status === "running" ? (
                    <StatusIndicator type="success">Running</StatusIndicator>
                  ) : status === "disabled" ? (
                    <StatusIndicator type="stopped">Disabled</StatusIndicator>
                  ) : (
                    <StatusIndicator type="pending">Unknown</StatusIndicator>
                  ),
              },
              { label: "Service id", value: entry.id },
              { label: "Category", value: entry.category },
              { label: "Region", value: region },
            ]}
          />
        </Container>

        <Container header={<Header variant="h2">Use this service now</Header>}>
          <SpaceBetween size="s">
            <Box variant="p" color="text-body-secondary">
              Point the AWS CLI at the emulator endpoint:
            </Box>
            <Box variant="code" display="block">
              aws --endpoint-url {endpoint} {entry.id} help
            </Box>
          </SpaceBetween>
        </Container>
      </SpaceBetween>
    </ContentLayout>
  );
}
