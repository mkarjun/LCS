import { useCallback, useEffect, useState } from "react";
import { CreateVolumeCommand } from "@aws-sdk/client-ec2";
import Checkbox from "@cloudscape-design/components/checkbox";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import type { SelectProps } from "@cloudscape-design/components/select";

import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";
import { useNotifications } from "@shell/NotificationContext";
import { useEc2Client } from "../useEc2Client";
import { CreateModalShell } from "./CreateModalShell";
import { loadAvailabilityZoneOptions, tagSpecifications, useCreateForm } from "./createForm";
import type { Ec2CreateModalProps } from "./createForm";

interface VolumeTypeOption extends SelectProps.Option {
  /** IOPS is only settable on the provisioned-IOPS and gp3 types. */
  iopsEditable: boolean;
  throughputEditable: boolean;
}

const VOLUME_TYPES: VolumeTypeOption[] = [
  {
    value: "gp3",
    label: "General purpose SSD (gp3)",
    iopsEditable: true,
    throughputEditable: true,
  },
  { value: "gp2", label: "General purpose SSD (gp2)", iopsEditable: false, throughputEditable: false },
  { value: "io1", label: "Provisioned IOPS SSD (io1)", iopsEditable: true, throughputEditable: false },
  { value: "io2", label: "Provisioned IOPS SSD (io2)", iopsEditable: true, throughputEditable: false },
  { value: "st1", label: "Throughput optimized HDD (st1)", iopsEditable: false, throughputEditable: false },
  { value: "sc1", label: "Cold HDD (sc1)", iopsEditable: false, throughputEditable: false },
  { value: "standard", label: "Magnetic (standard)", iopsEditable: false, throughputEditable: false },
];

/**
 * AWS's "Create volume" page. Snapshot ID is omitted: `DescribeSnapshots` is a wire-
 * accurate empty stub in LCS and `CreateSnapshot` is not implemented, so the picker could
 * never offer anything.
 */
export function CreateVolumeModal({ visible, onDismiss, onCreated }: Ec2CreateModalProps) {
  const client = useEc2Client();
  const { notify } = useNotifications();
  const { formError, setFormError, submitting, submit } = useCreateForm();

  const [volumeType, setVolumeType] = useState<VolumeTypeOption>(VOLUME_TYPES[0]);
  const [size, setSize] = useState("8");
  const [iops, setIops] = useState("3000");
  const [throughput, setThroughput] = useState("125");
  const [zones, setZones] = useState<SelectProps.Option[]>([]);
  const [zone, setZone] = useState<SelectProps.Option | null>(null);
  const [encrypted, setEncrypted] = useState(false);
  const [name, setName] = useState("");
  const [tags, setTags] = useState<KeyValuePair[]>([]);

  const loadZones = useCallback(async () => {
    try {
      const options = await loadAvailabilityZoneOptions(client);
      setZones(options);
      setZone(options[0] ?? null);
    } catch {
      setZones([]);
    }
  }, [client]);

  useEffect(() => {
    if (visible) {
      setVolumeType(VOLUME_TYPES[0]);
      setSize("8");
      setIops("3000");
      setThroughput("125");
      setEncrypted(false);
      setName("");
      setTags([]);
      setFormError(null);
      void loadZones();
    }
  }, [visible, loadZones, setFormError]);

  const onSubmit = () => {
    const parsedSize = Number.parseInt(size, 10);
    if (!Number.isFinite(parsedSize) || parsedSize < 1) {
      setFormError("Size must be at least 1 GiB.");
      return;
    }
    if (zone === null || !zone.value) {
      setFormError("Choose an Availability Zone.");
      return;
    }
    void submit(async () => {
      const parsedIops = Number.parseInt(iops, 10);
      const parsedThroughput = Number.parseInt(throughput, 10);
      const created = await client.send(
        new CreateVolumeCommand({
          AvailabilityZone: zone.value,
          VolumeType: volumeType.value as never,
          Size: parsedSize,
          Encrypted: encrypted,
          ...(volumeType.iopsEditable && Number.isFinite(parsedIops) ? { Iops: parsedIops } : {}),
          ...(volumeType.throughputEditable && Number.isFinite(parsedThroughput)
            ? { Throughput: parsedThroughput }
            : {}),
          TagSpecifications: tagSpecifications("volume", name, tags),
        }),
      );
      notify({ type: "success", content: `Volume ${created.VolumeId} created.` });
      await onCreated();
    });
  };

  return (
    <CreateModalShell
      visible={visible}
      onDismiss={onDismiss}
      header="Create volume"
      submitLabel="Create volume"
      onSubmit={onSubmit}
      submitting={submitting}
      formError={formError}
    >
      <FormField label="Volume type">
        <Select
          selectedOption={volumeType}
          options={VOLUME_TYPES}
          onChange={(event) =>
            setVolumeType(
              VOLUME_TYPES.find((type) => type.value === event.detail.selectedOption.value) ??
                VOLUME_TYPES[0],
            )
          }
        />
      </FormField>
      <FormField label="Size (GiB)" constraintText="1 GiB to 16384 GiB.">
        <Input
          value={size}
          type="number"
          inputMode="numeric"
          onChange={(event) => setSize(event.detail.value)}
        />
      </FormField>
      {volumeType.iopsEditable && (
        <FormField label="IOPS">
          <Input
            value={iops}
            type="number"
            inputMode="numeric"
            onChange={(event) => setIops(event.detail.value)}
          />
        </FormField>
      )}
      {volumeType.throughputEditable && (
        <FormField label="Throughput (MiB/s)">
          <Input
            value={throughput}
            type="number"
            inputMode="numeric"
            onChange={(event) => setThroughput(event.detail.value)}
          />
        </FormField>
      )}
      <FormField
        label="Availability Zone"
        description="A volume can only be attached to an instance in the same Availability Zone."
      >
        <Select
          selectedOption={zone}
          options={zones}
          placeholder="Choose an Availability Zone"
          onChange={(event) => setZone(event.detail.selectedOption)}
        />
      </FormField>
      <FormField label="Encryption">
        <Checkbox checked={encrypted} onChange={(event) => setEncrypted(event.detail.checked)}>
          Encrypt this volume
        </Checkbox>
      </FormField>
      <FormField
        label="Name"
        description="Creates a tag with a key of 'Name' and the value you specify."
      >
        <Input
          value={name}
          placeholder="my-volume"
          onChange={(event) => setName(event.detail.value)}
        />
      </FormField>
      <FormField label="Tags">
        <KeyValueEditor
          items={tags}
          onChange={setTags}
          keyLabel="Key"
          valueLabel="Value"
          addLabel="Add new tag"
          empty="No tags associated with this volume."
        />
      </FormField>
    </CreateModalShell>
  );
}
