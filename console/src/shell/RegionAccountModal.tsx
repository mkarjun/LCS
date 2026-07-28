import { useEffect, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { useEmulator } from "@platform/EmulatorContext";

interface RegionAccountModalProps {
  visible: boolean;
  onDismiss: () => void;
}

/**
 * Region and account switcher.
 *
 * LCS accepts any region, and derives the account from the access key when it is
 * exactly 12 digits — so account switching is access-key switching. Both are free
 * text rather than a fixed list, because the emulator does not restrict either.
 */
export function RegionAccountModal({ visible, onDismiss }: RegionAccountModalProps) {
  const { region, setRegion, accessKeyId, setAccessKeyId } = useEmulator();
  const [regionDraft, setRegionDraft] = useState(region);
  const [accessKeyDraft, setAccessKeyDraft] = useState(accessKeyId);

  useEffect(() => {
    if (visible) {
      setRegionDraft(region);
      setAccessKeyDraft(accessKeyId);
    }
  }, [visible, region, accessKeyId]);

  const apply = () => {
    setRegion(regionDraft.trim() === "" ? "us-east-1" : regionDraft.trim());
    setAccessKeyId(accessKeyDraft);
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Region and account"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button variant="primary" onClick={apply}>
              Apply
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="l">
        <FormField
          label="Region"
          description="LCS accepts any region name. Resources are isolated per region where the service supports it."
        >
          <Input
            value={regionDraft}
            onChange={(event) => setRegionDraft(event.detail.value)}
            placeholder="us-east-1"
          />
        </FormField>
        <FormField
          label="Access key ID"
          description="A 12-digit value selects that AWS account and isolates its resources. Any other value uses the emulator's default account."
        >
          <Input
            value={accessKeyDraft}
            onChange={(event) => setAccessKeyDraft(event.detail.value)}
            placeholder="test"
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}
