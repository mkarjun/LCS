import AttributeEditor from "@cloudscape-design/components/attribute-editor";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import type { IpPermission } from "@aws-sdk/client-ec2";

/** One editable row of a security group's inbound or outbound rules. */
export interface SgRuleDraft {
  /** Stable local key — rules have no id until EC2 assigns one. */
  key: string;
  type: string;
  protocol: string;
  fromPort: string;
  toPort: string;
  cidr: string;
  description: string;
}

interface RuleType {
  value: string;
  label: string;
  protocol: string;
  fromPort: string;
  toPort: string;
  /** Custom types let the user set the protocol and ports; presets pin them. */
  editablePorts?: boolean;
  editableProtocol?: boolean;
}

/**
 * The rule types AWS offers in its Type dropdown, in AWS's order. The presets exist so a
 * user picks "SSH" rather than remembering that it means tcp/22 — which is the whole
 * point of the AWS control.
 */
const RULE_TYPES: RuleType[] = [
  { value: "all-traffic", label: "All traffic", protocol: "-1", fromPort: "", toPort: "" },
  { value: "all-tcp", label: "All TCP", protocol: "tcp", fromPort: "0", toPort: "65535" },
  { value: "all-udp", label: "All UDP", protocol: "udp", fromPort: "0", toPort: "65535" },
  { value: "all-icmp-ipv4", label: "All ICMP - IPv4", protocol: "icmp", fromPort: "-1", toPort: "-1" },
  { value: "ssh", label: "SSH", protocol: "tcp", fromPort: "22", toPort: "22" },
  { value: "http", label: "HTTP", protocol: "tcp", fromPort: "80", toPort: "80" },
  { value: "https", label: "HTTPS", protocol: "tcp", fromPort: "443", toPort: "443" },
  { value: "rdp", label: "RDP", protocol: "tcp", fromPort: "3389", toPort: "3389" },
  { value: "mysql", label: "MYSQL/Aurora", protocol: "tcp", fromPort: "3306", toPort: "3306" },
  { value: "postgresql", label: "PostgreSQL", protocol: "tcp", fromPort: "5432", toPort: "5432" },
  {
    value: "custom-tcp",
    label: "Custom TCP",
    protocol: "tcp",
    fromPort: "",
    toPort: "",
    editablePorts: true,
  },
  {
    value: "custom-udp",
    label: "Custom UDP",
    protocol: "udp",
    fromPort: "",
    toPort: "",
    editablePorts: true,
  },
  {
    value: "custom-protocol",
    label: "Custom protocol",
    protocol: "",
    fromPort: "",
    toPort: "",
    editablePorts: true,
    editableProtocol: true,
  },
];

function ruleType(value: string): RuleType {
  return RULE_TYPES.find((type) => type.value === value) ?? RULE_TYPES[0];
}

let nextKey = 0;

export function newRuleDraft(direction: "inbound" | "outbound"): SgRuleDraft {
  nextKey += 1;
  // AWS pre-fills a new outbound rule as "All traffic to 0.0.0.0/0", which is the default
  // egress rule every group gets.
  const type = direction === "outbound" ? ruleType("all-traffic") : ruleType("custom-tcp");
  return {
    key: `rule-${nextKey}`,
    type: type.value,
    protocol: type.protocol,
    fromPort: type.fromPort,
    toPort: type.toPort,
    cidr: direction === "outbound" ? "0.0.0.0/0" : "",
    description: "",
  };
}

/** Turns an existing EC2 permission into an editable row, for the edit-rules flow. */
export function draftsFromPermissions(permissions: IpPermission[] | undefined): SgRuleDraft[] {
  return (permissions ?? []).flatMap((permission) =>
    (permission.IpRanges ?? []).map((range) => {
      nextKey += 1;
      const protocol = permission.IpProtocol ?? "-1";
      const from = permission.FromPort;
      const to = permission.ToPort;
      const matched = RULE_TYPES.find(
        (type) =>
          !type.editableProtocol &&
          type.protocol === protocol &&
          type.fromPort === (from === undefined ? "" : String(from)) &&
          type.toPort === (to === undefined ? "" : String(to)),
      );
      return {
        key: `rule-${nextKey}`,
        type: matched?.value ?? (protocol === "tcp" ? "custom-tcp" : "custom-protocol"),
        protocol,
        fromPort: from === undefined ? "" : String(from),
        toPort: to === undefined ? "" : String(to),
        cidr: range.CidrIp ?? "",
        description: range.Description ?? "",
      };
    }),
  );
}

/**
 * Converts rows to the `IpPermissions` shape the Authorize and Revoke calls take.
 *
 * Rows are not merged by protocol/port: EC2 accepts one permission per CIDR and keeping
 * them separate means each row's own description survives, which merging would drop.
 */
export function permissionsFromDrafts(drafts: SgRuleDraft[]): IpPermission[] {
  return drafts
    .filter((draft) => draft.cidr.trim() !== "")
    .map((draft) => {
      const protocol = draft.protocol.trim() === "" ? "-1" : draft.protocol.trim();
      const from = Number.parseInt(draft.fromPort, 10);
      const to = Number.parseInt(draft.toPort, 10);
      return {
        IpProtocol: protocol,
        // "-1" means every protocol, and EC2 rejects a port range alongside it.
        ...(protocol === "-1" || !Number.isFinite(from)
          ? {}
          : { FromPort: from, ToPort: Number.isFinite(to) ? to : from }),
        IpRanges: [
          {
            CidrIp: draft.cidr.trim(),
            ...(draft.description.trim() === "" ? {} : { Description: draft.description.trim() }),
          },
        ],
      };
    });
}

/** Rejects rows the API would reject, so the error lands on the form not in a flashbar. */
export function validateRuleDrafts(drafts: SgRuleDraft[]): string | null {
  for (const draft of drafts) {
    if (draft.cidr.trim() === "") {
      return "Every rule needs a source or destination CIDR block.";
    }
    if (!/^[0-9.]+\/\d{1,2}$|^[0-9a-fA-F:]+\/\d{1,3}$/.test(draft.cidr.trim())) {
      return `"${draft.cidr.trim()}" is not a CIDR block. Use a form such as 0.0.0.0/0 or 10.0.0.0/16.`;
    }
    const type = ruleType(draft.type);
    if (type.editableProtocol && draft.protocol.trim() === "") {
      return "Custom protocol rules need a protocol number or name.";
    }
    if (type.editablePorts && draft.fromPort.trim() === "") {
      return "Custom rules need a port range.";
    }
  }
  return null;
}

/**
 * The inbound/outbound rule table from AWS's security group forms.
 *
 * Source and destination are CIDR blocks only. AWS also allows another security group or
 * a prefix list as the source; LCS stores `UserIdGroupPairs` but does not evaluate them,
 * so offering the choice would imply enforcement that does not happen.
 */
export function SecurityGroupRulesEditor({
  direction,
  rules,
  onChange,
}: {
  direction: "inbound" | "outbound";
  rules: SgRuleDraft[];
  onChange: (rules: SgRuleDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<SgRuleDraft>) => {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  return (
    <AttributeEditor
      items={rules}
      addButtonText={direction === "inbound" ? "Add rule" : "Add rule"}
      removeButtonText="Delete"
      empty={`No ${direction} rules. This security group will ${
        direction === "inbound" ? "not accept any incoming traffic" : "block all outgoing traffic"
      }.`}
      onAddButtonClick={() => onChange([...rules, newRuleDraft(direction)])}
      onRemoveButtonClick={(event) =>
        onChange(rules.filter((_, index) => index !== event.detail.itemIndex))
      }
      definition={[
        {
          label: "Type",
          control: (rule: SgRuleDraft, index) => (
            <Select
              selectedOption={{ value: rule.type, label: ruleType(rule.type).label }}
              options={RULE_TYPES.map((type) => ({ value: type.value, label: type.label }))}
              onChange={(event) => {
                const picked = ruleType(event.detail.selectedOption.value ?? "");
                update(index, {
                  type: picked.value,
                  protocol: picked.protocol,
                  fromPort: picked.fromPort,
                  toPort: picked.toPort,
                });
              }}
            />
          ),
        },
        {
          label: "Protocol",
          control: (rule: SgRuleDraft, index) => (
            <Input
              value={ruleType(rule.type).protocol === "-1" ? "All" : rule.protocol}
              disabled={!ruleType(rule.type).editableProtocol}
              placeholder="tcp"
              onChange={(event) => update(index, { protocol: event.detail.value })}
            />
          ),
        },
        {
          label: "Port range",
          control: (rule: SgRuleDraft, index) => (
            <Input
              value={ruleType(rule.type).protocol === "-1" ? "All" : rule.fromPort}
              disabled={!ruleType(rule.type).editablePorts}
              placeholder="8080"
              onChange={(event) =>
                // A single port fills both ends, as typing "80" in AWS does.
                update(index, { fromPort: event.detail.value, toPort: event.detail.value })
              }
            />
          ),
        },
        {
          label: direction === "inbound" ? "Source" : "Destination",
          control: (rule: SgRuleDraft, index) => (
            <Input
              value={rule.cidr}
              placeholder="0.0.0.0/0"
              onChange={(event) => update(index, { cidr: event.detail.value })}
            />
          ),
        },
        {
          label: "Description",
          control: (rule: SgRuleDraft, index) => (
            <Input
              value={rule.description}
              placeholder="Optional"
              onChange={(event) => update(index, { description: event.detail.value })}
            />
          ),
        },
      ]}
    />
  );
}
