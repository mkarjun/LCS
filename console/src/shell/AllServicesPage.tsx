import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "@cloudscape-design/components/badge";
import Box from "@cloudscape-design/components/box";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import TextFilter from "@cloudscape-design/components/text-filter";

import { SERVICE_CATALOG, servicePath, servicesByCategory } from "@services/catalog";
import { isImplemented } from "@services/registry";
import { useBreadcrumbs } from "./BreadcrumbContext";
import { ServiceIcon } from "./ServiceIcon";

export function AllServicesPage() {
  const navigate = useNavigate();
  const [filterText, setFilterText] = useState("");

  useBreadcrumbs([{ text: "All services", href: "/services" }]);

  const query = filterText.trim().toLowerCase();
  const groups = useMemo(
    () =>
      servicesByCategory()
        .map((group) => ({
          ...group,
          services: group.services.filter(
            (entry) =>
              query === "" ||
              entry.name.toLowerCase().includes(query) ||
              entry.shortName.toLowerCase().includes(query) ||
              entry.id.toLowerCase().includes(query) ||
              entry.description.toLowerCase().includes(query),
          ),
        }))
        .filter((group) => group.services.length > 0),
    [query],
  );

  const matchCount = groups.reduce((total, group) => total + group.services.length, 0);

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          counter={`(${SERVICE_CATALOG.length})`}
          description="Every service emulated by LCS. Services without a console surface yet are still fully usable through the AWS CLI and SDKs."
        >
          All services
        </Header>
      }
    >
      <SpaceBetween size="l">
        <TextFilter
          filteringText={filterText}
          filteringPlaceholder="Find services"
          filteringAriaLabel="Find services"
          countText={query ? `${matchCount} matches` : ""}
          onChange={(event) => setFilterText(event.detail.filteringText)}
        />

        {groups.length === 0 ? (
          <Container>
            <Box textAlign="center" padding={{ vertical: "l" }} color="text-body-secondary">
              No services matched "{filterText}".
            </Box>
          </Container>
        ) : (
          groups.map((group) => (
            <Container key={group.category} header={<Header variant="h2">{group.category}</Header>}>
              <ColumnLayout columns={3} borders="horizontal">
                {group.services.map((entry) => (
                  <div key={entry.id}>
                    <SpaceBetween size="xxs">
                      <SpaceBetween size="xs" direction="horizontal">
                        <ServiceIcon entry={entry} size={20} />
                        <Link
                          fontSize="body-m"
                          href={`/${servicePath(entry)}`}
                          onFollow={(event) => {
                            event.preventDefault();
                            navigate(`/${servicePath(entry)}`);
                          }}
                        >
                          {entry.name}
                        </Link>
                        {isImplemented(entry) && <Badge color="green">Console</Badge>}
                      </SpaceBetween>
                      <Box variant="small" color="text-body-secondary">
                        {entry.description}
                      </Box>
                    </SpaceBetween>
                  </div>
                ))}
              </ColumnLayout>
            </Container>
          ))
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
