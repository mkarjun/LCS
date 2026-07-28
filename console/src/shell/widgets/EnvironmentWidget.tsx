import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import { useEmulator } from "@platform/EmulatorContext";

export function EnvironmentWidget() {
  const { summary, region, effectiveAccountId } = useEmulator();

  return (
    <KeyValuePairs
      columns={2}
      items={[
        { label: "Endpoint", value: window.location.origin },
        { label: "Region", value: region },
        { label: "Account", value: effectiveAccountId },
        { label: "Version", value: summary?.version ?? "-" },
      ]}
    />
  );
}
