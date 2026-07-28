import { useNavigate } from "react-router-dom";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { useBreadcrumbs } from "./BreadcrumbContext";

export function NotFoundPage() {
  const navigate = useNavigate();
  useBreadcrumbs([]);

  return (
    <ContentLayout header={<Header variant="h1">Page not found</Header>}>
      <Box textAlign="center" padding={{ vertical: "xxl" }}>
        <SpaceBetween size="m">
          <Box variant="p" color="text-body-secondary">
            This console route doesn't exist. The service may not have a console surface in this
            build.
          </Box>
          <Button variant="primary" onClick={() => navigate("/")}>
            Go to console home
          </Button>
        </SpaceBetween>
      </Box>
    </ContentLayout>
  );
}
