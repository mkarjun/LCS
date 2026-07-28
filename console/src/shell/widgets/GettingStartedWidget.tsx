import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";

export function GettingStartedWidget() {
  const endpoint = window.location.origin;

  return (
    <SpaceBetween size="m">
      <SpaceBetween size="xxs">
        <Box variant="awsui-key-label">AWS CLI</Box>
        <Box variant="code" display="block">
          aws --endpoint-url {endpoint} s3 ls
        </Box>
      </SpaceBetween>
      <SpaceBetween size="xxs">
        <Box variant="awsui-key-label">Environment</Box>
        <Box variant="code" display="block">
          export AWS_ENDPOINT_URL={endpoint}
        </Box>
      </SpaceBetween>
      <Box variant="small" color="text-body-secondary">
        Any region works, and credentials can be any non-empty values. A 12-digit access key
        id selects that account and isolates its resources.
      </Box>
    </SpaceBetween>
  );
}
