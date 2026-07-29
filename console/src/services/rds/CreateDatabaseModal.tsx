import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CreateDBClusterCommand,
  CreateDBInstanceCommand,
  DescribeDBSubnetGroupsCommand,
  DescribeOrderableDBInstanceOptionsCommand,
  RDSClient,
} from "@aws-sdk/client-rds";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import Container from "@cloudscape-design/components/container";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Multiselect from "@cloudscape-design/components/multiselect";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tiles from "@cloudscape-design/components/tiles";
import type { SelectProps } from "@cloudscape-design/components/select";
import { DescribeAvailabilityZonesCommand, DescribeSecurityGroupsCommand, EC2Client } from "@aws-sdk/client-ec2";

import { describeAwsError, useAwsClient } from "@platform/awsClient";
import { useNotifications } from "@shell/NotificationContext";
import { KeyValueEditor } from "@shell/KeyValueEditor";
import type { KeyValuePair } from "@shell/KeyValueEditor";

interface OrderableOption {
  engineVersion: string;
  instanceClass: string;
}

/**
 * AWS's Engine options tiles, in AWS's order.
 *
 * LCS starts a real database container per instance, so it can only offer engines it has
 * an image for. The rest are shown disabled rather than dropped, so the tile grid matches
 * the AWS console and the gap is visible.
 */
const ENGINE_TILES = [
  { value: "aurora-mysql", label: "Aurora (MySQL Compatible)", supported: false },
  { value: "aurora-postgresql", label: "Aurora (PostgreSQL Compatible)", supported: false },
  { value: "mysql", label: "MySQL", supported: true },
  { value: "postgres", label: "PostgreSQL", supported: true },
  { value: "mariadb", label: "MariaDB", supported: true },
  { value: "oracle-ee", label: "Oracle", supported: false },
  { value: "sqlserver-ex", label: "Microsoft SQL Server", supported: false },
  { value: "db2-se", label: "IBM Db2", supported: false },
];

/**
 * Create database — AWS's "Full configuration" path.
 *
 * AWS's version is a full-page wizard. This carries its section structure (Engine options,
 * Settings, Credentials, Connectivity, Tags) and every field CreateDBInstance and
 * CreateDBCluster actually honour. AWS sections with no backend — Templates, Cluster
 * scalability type, Cluster storage configuration, Read replica write forwarding,
 * Babelfish, Monitoring, Certificate authority, Network type, Compute resource — are
 * omitted here rather than drawn as controls that would silently do nothing, and are
 * listed in the completeness backlog. The unsupported *engines* are shown disabled because
 * the tile grid is the one place the omission would otherwise be invisible.
 *
 * Engine version and instance class come from DescribeOrderableDBInstanceOptions rather
 * than a hard-coded list, so the picker can never offer a combination the emulator will
 * reject.
 */
export function CreateDatabaseModal({
  visible,
  onDismiss,
  onCreated,
}: {
  visible: boolean;
  onDismiss: () => void;
  onCreated: (identifier: string, kind: "instance" | "cluster") => Promise<void>;
}) {
  const client = useAwsClient(RDSClient);
  // Subnet groups come from RDS, but security groups and AZs come from EC2 — the same
  // split the AWS console's Connectivity section reads from.
  const ec2 = useAwsClient(EC2Client);
  const { notify } = useNotifications();

  const [options, setOptions] = useState<OrderableOption[]>([]);
  const [subnetGroups, setSubnetGroups] = useState<string[]>([]);
  const [securityGroups, setSecurityGroups] = useState<SelectProps.Option[]>([]);
  const [zones, setZones] = useState<string[]>([]);
  const [kind, setKind] = useState<"instance" | "cluster">("instance");
  const [identifier, setIdentifier] = useState("");
  const [engine, setEngine] = useState("postgres");
  const [engineVersion, setEngineVersion] = useState<SelectProps.Option | null>(null);
  const [instanceClass, setInstanceClass] = useState<SelectProps.Option | null>(null);
  const [subnetGroup, setSubnetGroup] = useState<SelectProps.Option | null>(null);
  const [chosenSecurityGroups, setChosenSecurityGroups] = useState<readonly SelectProps.Option[]>(
    [],
  );
  const [availabilityZone, setAvailabilityZone] = useState<SelectProps.Option | null>(null);
  const [multiAz, setMultiAz] = useState(false);
  const [credentialsManagement, setCredentialsManagement] = useState<"self" | "secrets">("self");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [dbName, setDbName] = useState("");
  const [storage, setStorage] = useState("20");
  const [iamAuth, setIamAuth] = useState(false);
  const [tags, setTags] = useState<KeyValuePair[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadConnectivity = useCallback(async () => {
    const [subnetResult, securityResult, zoneResult] = await Promise.allSettled([
      client.send(new DescribeDBSubnetGroupsCommand({})),
      ec2.send(new DescribeSecurityGroupsCommand({})),
      ec2.send(new DescribeAvailabilityZonesCommand({})),
    ]);
    setZones(
      zoneResult.status === "fulfilled"
        ? (zoneResult.value.AvailabilityZones ?? [])
            .map((zone) => zone.ZoneName ?? "")
            .filter((name) => name !== "")
        : [],
    );
    setSubnetGroups(
      subnetResult.status === "fulfilled"
        ? (subnetResult.value.DBSubnetGroups ?? [])
            .map((group) => group.DBSubnetGroupName ?? "")
            .filter((name) => name !== "")
        : [],
    );
    setSecurityGroups(
      securityResult.status === "fulfilled"
        ? (securityResult.value.SecurityGroups ?? []).map((group) => ({
            label: group.GroupName ?? group.GroupId ?? "",
            value: group.GroupId ?? "",
            description: group.VpcId,
          }))
        : [],
    );
  }, [client, ec2]);

  // Versions and classes are per-engine, so they reload whenever the engine changes.
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const response = await client.send(
          new DescribeOrderableDBInstanceOptionsCommand({ Engine: engine }),
        );
        if (current) {
          setOptions(
            (response.OrderableDBInstanceOptions ?? []).map((option) => ({
              engineVersion: option.EngineVersion ?? "",
              instanceClass: option.DBInstanceClass ?? "",
            })),
          );
        }
      } catch {
        if (current) {
          setOptions([]);
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [client, engine]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setKind("instance");
    setIdentifier("");
    setEngine("postgres");
    setEngineVersion(null);
    setInstanceClass(null);
    setSubnetGroup(null);
    setChosenSecurityGroups([]);
    setAvailabilityZone(null);
    setMultiAz(false);
    setCredentialsManagement("self");
    setUsername("admin");
    setPassword("");
    setDbName("");
    setStorage("20");
    setIamAuth(false);
    setTags([]);
    setFormError(null);
    void loadConnectivity();
  }, [visible, loadConnectivity]);

  const versionOptions: SelectProps.Option[] = useMemo(
    () =>
      [...new Set(options.map((option) => option.engineVersion))].map((value) => ({
        label: value,
        value,
      })),
    [options],
  );

  // Classes are narrowed to the chosen version, so every visible combination is one
  // DescribeOrderableDBInstanceOptions actually returned.
  const classOptions: SelectProps.Option[] = useMemo(
    () =>
      [
        ...new Set(
          options
            .filter(
              (option) =>
                engineVersion === null || option.engineVersion === engineVersion.value,
            )
            .map((option) => option.instanceClass),
        ),
      ].map((value) => ({ label: value, value })),
    [options, engineVersion],
  );

  const submit = async () => {
    if (identifier.trim() === "") {
      setFormError("DB identifier is required.");
      return;
    }
    // With Secrets Manager management RDS generates the password, so the field is only
    // required when the user manages it themselves.
    if (credentialsManagement === "self" && password.trim() === "") {
      setFormError("Master password is required when you manage the credentials yourself.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      // The two APIs take the same settings under different field names — DBName on an
      // instance is DatabaseName on a cluster — so they are spelled out separately.
      const initialDbName = dbName.trim() === "" ? undefined : dbName.trim();
      const managed = credentialsManagement === "secrets";
      const securityGroupIds = chosenSecurityGroups.map((option) => option.value ?? "");
      const tagList = tags
        .filter((pair) => pair.key.trim() !== "")
        .map((pair) => ({ Key: pair.key.trim(), Value: pair.value }));
      if (kind === "cluster") {
        await client.send(
          new CreateDBClusterCommand({
            DBClusterIdentifier: identifier.trim(),
            Engine: engine,
            EngineVersion: engineVersion?.value,
            MasterUsername: username.trim(),
            MasterUserPassword: managed ? undefined : password,
            ManageMasterUserPassword: managed ? true : undefined,
            DBSubnetGroupName: subnetGroup?.value,
            DatabaseName: initialDbName,
            EnableIAMDatabaseAuthentication: iamAuth,
            VpcSecurityGroupIds: securityGroupIds.length === 0 ? undefined : securityGroupIds,
            AvailabilityZones: availabilityZone ? [availabilityZone.value ?? ""] : undefined,
            Tags: tagList.length === 0 ? undefined : tagList,
          }),
        );
      } else {
        await client.send(
          new CreateDBInstanceCommand({
            DBInstanceIdentifier: identifier.trim(),
            DBInstanceClass: instanceClass?.value ?? "db.t3.micro",
            AllocatedStorage: Number.parseInt(storage, 10) || 20,
            Engine: engine,
            EngineVersion: engineVersion?.value,
            MasterUsername: username.trim(),
            MasterUserPassword: managed ? undefined : password,
            ManageMasterUserPassword: managed ? true : undefined,
            DBSubnetGroupName: subnetGroup?.value,
            DBName: initialDbName,
            EnableIAMDatabaseAuthentication: iamAuth,
            VpcSecurityGroupIds: securityGroupIds.length === 0 ? undefined : securityGroupIds,
            // Multi-AZ and a pinned AZ are mutually exclusive in AWS, and the emulator
            // stores whichever is sent, so only one is ever included.
            MultiAZ: multiAz ? true : undefined,
            AvailabilityZone: multiAz ? undefined : availabilityZone?.value,
            Tags: tagList.length === 0 ? undefined : tagList,
          }),
        );
      }
      notify({ type: "success", content: `Database "${identifier.trim()}" created.` });
      await onCreated(identifier.trim(), kind);
    } catch (cause) {
      const { title, detail } = describeAwsError(cause);
      setFormError(`${title}: ${detail}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      size="large"
      header="Create database"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Create database
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Form errorText={formError}>
        <SpaceBetween size="l">
          <Container header={<Header variant="h3">Engine options</Header>}>
            <SpaceBetween size="l">
              <FormField label="Engine type">
                <Tiles
                  value={engine}
                  onChange={(event) => {
                    setEngine(event.detail.value);
                    // Versions and classes are engine-specific, so a change invalidates both.
                    setEngineVersion(null);
                    setInstanceClass(null);
                  }}
                  columns={4}
                  items={ENGINE_TILES.map((tile) => ({
                    value: tile.value,
                    label: tile.label,
                    disabled: !tile.supported,
                    description: tile.supported
                      ? undefined
                      : "LCS has no container image for this engine.",
                  }))}
                />
              </FormField>

              <FormField label="Engine version">
                <Select
                  selectedOption={engineVersion}
                  options={versionOptions}
                  placeholder="Default for the engine"
                  onChange={(event) => {
                    setEngineVersion(event.detail.selectedOption);
                    setInstanceClass(null);
                  }}
                />
              </FormField>
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h3">Settings</Header>}>
            <SpaceBetween size="l">
              <FormField label="Database type">
                <Tiles
                  value={kind}
                  onChange={(event) => setKind(event.detail.value as "instance" | "cluster")}
                  items={[
                    {
                      value: "instance",
                      label: "Standalone instance",
                      description: "A single database instance with its own endpoint.",
                    },
                    {
                      value: "cluster",
                      label: "Cluster",
                      description: "A writer endpoint that instances can be added to.",
                    },
                  ]}
                />
              </FormField>

              <FormField
                label={kind === "cluster" ? "DB cluster identifier" : "DB instance identifier"}
                description="Unique across the databases in this Region."
              >
                <Input
                  value={identifier}
                  autoFocus
                  placeholder="my-database"
                  onChange={(event) => setIdentifier(event.detail.value)}
                />
              </FormField>

              {kind === "instance" && (
                <>
                  <FormField label="DB instance class">
                    <Select
                      selectedOption={instanceClass}
                      options={classOptions}
                      placeholder="db.t3.micro"
                      onChange={(event) => setInstanceClass(event.detail.selectedOption)}
                    />
                  </FormField>
                  <FormField label="Allocated storage (GiB)">
                    <Input
                      value={storage}
                      type="number"
                      inputMode="numeric"
                      onChange={(event) => setStorage(event.detail.value)}
                    />
                  </FormField>
                </>
              )}

              <FormField
                label="Initial database name - optional"
                description="Leave empty to create the database without an initial schema."
              >
                <Input
                  value={dbName}
                  placeholder="appdb"
                  onChange={(event) => setDbName(event.detail.value)}
                />
              </FormField>
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h3">Credentials settings</Header>}>
            <SpaceBetween size="l">
              <FormField label="Master username">
                <Input value={username} onChange={(event) => setUsername(event.detail.value)} />
              </FormField>

              <FormField label="Credentials management">
                <Tiles
                  value={credentialsManagement}
                  onChange={(event) =>
                    setCredentialsManagement(event.detail.value as "self" | "secrets")
                  }
                  items={[
                    {
                      value: "self",
                      label: "Self managed",
                      description: "Set the master password yourself.",
                    },
                    {
                      value: "secrets",
                      label: "Managed in AWS Secrets Manager",
                      description:
                        "RDS generates the password and stores it as a secret you can read back.",
                    },
                  ]}
                />
              </FormField>

              {credentialsManagement === "self" && (
                <FormField
                  label="Master password"
                  description="Sets the password on the database container LCS starts."
                >
                  <Input
                    value={password}
                    type="password"
                    onChange={(event) => setPassword(event.detail.value)}
                  />
                </FormField>
              )}

              <FormField label="Database authentication">
                <Checkbox checked={iamAuth} onChange={(event) => setIamAuth(event.detail.checked)}>
                  Enable IAM database authentication
                </Checkbox>
              </FormField>
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h3">Availability &amp; connectivity</Header>}>
            <SpaceBetween size="l">
              {kind === "instance" && (
                <FormField label="Multi-AZ deployment">
                  <Checkbox
                    checked={multiAz}
                    onChange={(event) => setMultiAz(event.detail.checked)}
                  >
                    Deploy across multiple Availability Zones
                  </Checkbox>
                </FormField>
              )}

              <FormField
                label="Availability zone - optional"
                description={
                  multiAz
                    ? "Not applicable to a Multi-AZ deployment."
                    : "Leave empty to let RDS choose."
                }
              >
                <Select
                  selectedOption={availabilityZone}
                  options={zones.map((name) => ({ label: name, value: name }))}
                  disabled={multiAz}
                  placeholder="No preference"
                  onChange={(event) => setAvailabilityZone(event.detail.selectedOption)}
                />
              </FormField>

              <FormField label="DB subnet group">
                <Select
                  selectedOption={subnetGroup}
                  options={subnetGroups.map((name) => ({ label: name, value: name }))}
                  placeholder="default"
                  onChange={(event) => setSubnetGroup(event.detail.selectedOption)}
                />
              </FormField>

              <FormField label="VPC security groups">
                <Multiselect
                  selectedOptions={chosenSecurityGroups}
                  options={securityGroups}
                  placeholder="default"
                  empty="No security groups found in EC2"
                  onChange={(event) => setChosenSecurityGroups(event.detail.selectedOptions)}
                />
              </FormField>
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h3">Tags - optional</Header>}>
            <KeyValueEditor
              items={tags}
              onChange={setTags}
              keyLabel="Key"
              valueLabel="Value"
              addLabel="Add tag"
              empty="No tags"
            />
          </Container>
        </SpaceBetween>
      </Form>
    </Modal>
  );
}
