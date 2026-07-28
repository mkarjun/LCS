import { useNavigate } from "react-router-dom";
import Box from "@cloudscape-design/components/box";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";

import { useEmulator } from "@platform/EmulatorContext";
import { findById, servicePath } from "@services/catalog";

export function ServiceHealthWidget() {
  const navigate = useNavigate();
  const { summary, loading, error } = useEmulator();

  if (loading) {
    return <Spinner />;
  }

  if (error || summary === null) {
    return (
      <StatusIndicator type="warning">
        Service catalog unavailable
      </StatusIndicator>
    );
  }

  const disabled = summary.services.filter((service) => !service.enabled);

  return (
    <SpaceBetween size="m">
      <ColumnLayout columns={2} variant="text-grid">
        <div>
          <Box variant="awsui-key-label">Running</Box>
          <Box variant="awsui-value-large" color="text-status-success">
            {summary.runningCount}
          </Box>
        </div>
        <div>
          <Box variant="awsui-key-label">Disabled</Box>
          <Box variant="awsui-value-large">{summary.availableCount}</Box>
        </div>
      </ColumnLayout>

      {disabled.length > 0 && (
        <SpaceBetween size="xs">
          <Box variant="awsui-key-label">Disabled services</Box>
          <SpaceBetween size="xxs" direction="horizontal">
            {disabled.slice(0, 6).map((service) => {
              const entry = findById(service.id);
              return entry ? (
                <Link
                  key={service.id}
                  href={`/${servicePath(entry)}`}
                  onFollow={(event) => {
                    event.preventDefault();
                    navigate(`/${servicePath(entry)}`);
                  }}
                >
                  {entry.shortName}
                </Link>
              ) : (
                <Box key={service.id} variant="span">
                  {service.id}
                </Box>
              );
            })}
          </SpaceBetween>
        </SpaceBetween>
      )}
    </SpaceBetween>
  );
}
