import {
  DeleteNatGatewayCommand,
  DeleteNetworkAclCommand,
  DeleteVpcEndpointsCommand,
  DescribeNatGatewaysCommand,
  DescribeNetworkAclsCommand,
  DescribePrefixListsCommand,
  DescribeVpcEndpointsCommand,
} from "@aws-sdk/client-ec2";

import { nameTag } from "../useEc2Client";
import { byNumber, byText, deleteAction, ResourceLink } from "../resourceTable";
import type { ResourceDefinition, Row } from "../resourceTable";
import { EC2_API_RESOURCES } from "../resources";
import { CreateNatGatewayModal } from "./create/CreateNatGatewayModal";
import { CreateNetworkAclModal } from "./create/CreateNetworkAclModal";
import { CreateVpcEndpointModal } from "./create/CreateVpcEndpointModal";

/**
 * Resources that belong to the VPC console alone.
 *
 * Everything the VPC console shares with EC2 — VPCs, subnets, route tables, internet
 * gateways, security groups, Elastic IPs, network interfaces — is defined once in
 * `resources.tsx` and pulled in below.
 */
const VPC_ONLY_RESOURCES: Record<string, ResourceDefinition> = {
  "nat-gateways": {
    title: "NAT gateways",
    description:
      "A NAT gateway lets instances in a private subnet reach the internet without being reachable from it.",
    filterPlaceholder: "Find NAT gateway",
    emptyText: "You do not have any NAT gateways in this Region.",
    trackBy: (row) => row.NatGatewayId,
    load: async ({ ec2 }) =>
      (await ec2.send(new DescribeNatGatewaysCommand({}))).NatGateways ?? [],
    create: { label: "Create NAT gateway", Modal: CreateNatGatewayModal },
    actions: [
      deleteAction({
        label: "Delete NAT gateway",
        header: "Delete NAT gateway?",
        consequence:
          "Deleting a NAT gateway breaks internet access for every private subnet routing through it. Routes that point at it are not removed automatically.",
        confirmPhrase: "delete",
        describe: (row) => `${row.NatGatewayId} (${row.SubnetId})`,
        run: async ({ ec2 }, row) =>
          void (await ec2.send(new DeleteNatGatewayCommand({ NatGatewayId: row.NatGatewayId }))),
      }),
    ],
    columns: [
      {
        id: "name",
        header: "Name",
        cell: (row) => nameTag(row.Tags),
        isRowHeader: true,
        sortingComparator: byText((row) => nameTag(row.Tags)),
      },
      {
        id: "id",
        header: "NAT gateway ID",
        cell: (row) => row.NatGatewayId ?? "-",
        sortingComparator: byText((row) => row.NatGatewayId),
      },
      {
        id: "state",
        header: "State",
        cell: (row) => row.State ?? "-",
        sortingComparator: byText((row) => row.State),
      },
      {
        id: "connectivity",
        header: "Connectivity type",
        cell: (row) => row.ConnectivityType ?? "public",
        sortingComparator: byText((row) => row.ConnectivityType),
      },
      {
        id: "eip",
        header: "Elastic IP allocation ID",
        cell: (row) => (row.NatGatewayAddresses ?? [])[0]?.AllocationId ?? "—",
      },
      {
        id: "subnet",
        header: "Subnet",
        cell: (row) => row.SubnetId ?? "-",
        sortingComparator: byText((row) => row.SubnetId),
      },
      {
        id: "vpc",
        header: "VPC",
        cell: (row) => row.VpcId ?? "-",
        sortingComparator: byText((row) => row.VpcId),
      },
      {
        id: "created",
        header: "Created",
        cell: (row) => (row.CreateTime ? new Date(row.CreateTime).toLocaleString() : "—"),
        sortingComparator: byNumber((row) =>
          row.CreateTime ? new Date(row.CreateTime).getTime() : 0,
        ),
      },
    ],
  },
  endpoints: {
    title: "Endpoints",
    description:
      "A VPC endpoint connects your VPC to a supported service without leaving the AWS network.",
    filterPlaceholder: "Find endpoint",
    emptyText: "You do not have any endpoints in this Region.",
    trackBy: (row) => row.VpcEndpointId,
    load: async ({ ec2 }) =>
      (await ec2.send(new DescribeVpcEndpointsCommand({}))).VpcEndpoints ?? [],
    create: { label: "Create endpoint", Modal: CreateVpcEndpointModal },
    actions: [
      deleteAction({
        label: "Delete endpoint",
        header: "Delete endpoint?",
        consequence:
          "Traffic that reaches the service through this endpoint stops immediately. Route table entries and DNS names created for it are removed with it.",
        confirmPhrase: "delete",
        describe: (row) => `${row.VpcEndpointId} (${row.ServiceName})`,
        run: async ({ ec2 }, row) =>
          void (await ec2.send(
            new DeleteVpcEndpointsCommand({ VpcEndpointIds: [row.VpcEndpointId] }),
          )),
      }),
    ],
    columns: [
      {
        id: "name",
        header: "Name",
        cell: (row) => nameTag(row.Tags),
        isRowHeader: true,
        sortingComparator: byText((row) => nameTag(row.Tags)),
      },
      {
        id: "id",
        header: "Endpoint ID",
        cell: (row) => row.VpcEndpointId ?? "-",
        sortingComparator: byText((row) => row.VpcEndpointId),
      },
      {
        id: "service",
        header: "Service name",
        cell: (row) => row.ServiceName ?? "-",
        sortingComparator: byText((row) => row.ServiceName),
      },
      {
        id: "type",
        header: "Endpoint type",
        cell: (row) => row.VpcEndpointType ?? "-",
        sortingComparator: byText((row) => row.VpcEndpointType),
      },
      {
        id: "vpc",
        header: "VPC ID",
        cell: (row) => row.VpcId ?? "-",
        sortingComparator: byText((row) => row.VpcId),
      },
      {
        id: "state",
        header: "Status",
        cell: (row) => row.State ?? "-",
        sortingComparator: byText((row) => row.State),
      },
      {
        id: "dns",
        header: "Private DNS names enabled",
        cell: (row) => (row.PrivateDnsEnabled ? "Yes" : "No"),
      },
      {
        id: "subnets",
        header: "Subnets",
        cell: (row) => (row.SubnetIds ?? []).join(", ") || "—",
      },
    ],
  },
  "network-acls": {
    title: "Network ACLs",
    description:
      "A network ACL is a stateless firewall for the subnets it is associated with, evaluated in rule-number order.",
    filterPlaceholder: "Find network ACL",
    emptyText: "You do not have any network ACLs in this Region.",
    trackBy: (row) => row.NetworkAclId,
    load: async ({ ec2 }) =>
      (await ec2.send(new DescribeNetworkAclsCommand({}))).NetworkAcls ?? [],
    create: { label: "Create network ACL", Modal: CreateNetworkAclModal },
    actions: [
      deleteAction({
        label: "Delete network ACL",
        header: "Delete network ACL?",
        consequence:
          "A network ACL cannot be deleted while it is the default ACL for a VPC or still associated with a subnet.",
        confirmPhrase: "delete",
        describe: (row) => `${row.NetworkAclId} (${row.VpcId})`,
        run: async ({ ec2 }, row) =>
          void (await ec2.send(new DeleteNetworkAclCommand({ NetworkAclId: row.NetworkAclId }))),
      }),
    ],
    columns: [
      {
        id: "name",
        header: "Name",
        cell: (row) => nameTag(row.Tags),
        isRowHeader: true,
        sortingComparator: byText((row) => nameTag(row.Tags)),
      },
      {
        id: "id",
        header: "Network ACL ID",
        cell: (row) => row.NetworkAclId ?? "-",
        sortingComparator: byText((row) => row.NetworkAclId),
      },
      {
        id: "associated",
        header: "Associated with",
        cell: (row) => {
          const count = (row.Associations ?? []).length;
          return count === 0 ? "—" : `${count} Subnet${count === 1 ? "" : "s"}`;
        },
        sortingComparator: byNumber((row) => (row.Associations ?? []).length),
      },
      { id: "default", header: "Default", cell: (row) => (row.IsDefault ? "Yes" : "No") },
      {
        id: "vpc",
        header: "VPC",
        cell: (row) => row.VpcId ?? "-",
        sortingComparator: byText((row) => row.VpcId),
      },
      {
        id: "inbound",
        header: "Inbound rules",
        cell: (row) => aclRuleCount(row.Entries, false),
        sortingComparator: byNumber(
          (row) => (row.Entries ?? []).filter((entry: Row) => !entry.Egress).length,
        ),
      },
      {
        id: "outbound",
        header: "Outbound rules",
        cell: (row) => aclRuleCount(row.Entries, true),
        sortingComparator: byNumber(
          (row) => (row.Entries ?? []).filter((entry: Row) => entry.Egress).length,
        ),
      },
      { id: "owner", header: "Owner", cell: (row) => row.OwnerId ?? "—" },
    ],
  },
  "managed-prefix-lists": {
    title: "Managed prefix lists",
    description:
      "A prefix list is a named set of CIDR blocks that can be referenced from a security group or route table.",
    filterPlaceholder: "Find prefix list",
    emptyText: "You do not have any prefix lists in this Region.",
    trackBy: (row) => row.PrefixListId,
    // Read-only: LCS serves DescribePrefixLists, which returns the AWS-managed service
    // prefix lists. Customer-managed lists need CreateManagedPrefixList, which LCS does
    // not implement, so there is no create or delete flow here.
    load: async ({ ec2 }) =>
      (await ec2.send(new DescribePrefixListsCommand({}))).PrefixLists ?? [],
    columns: [
      {
        id: "name",
        header: "Prefix list name",
        cell: (row) => row.PrefixListName ?? "-",
        isRowHeader: true,
        sortingComparator: byText((row) => row.PrefixListName),
      },
      {
        id: "id",
        header: "Prefix list ID",
        cell: (row) => row.PrefixListId ?? "-",
        sortingComparator: byText((row) => row.PrefixListId),
      },
      { id: "owner", header: "Owner ID", cell: () => "AWS" },
      {
        id: "entries",
        header: "Entries",
        cell: (row) => String((row.Cidrs ?? []).length),
        sortingComparator: byNumber((row) => (row.Cidrs ?? []).length),
      },
      {
        id: "cidrs",
        header: "CIDR blocks",
        cell: (row) => (row.Cidrs ?? []).join(", ") || "—",
      },
    ],
  },
};

/** "3 Inbound rules" the way AWS counts them, or "—" when the ACL has none. */
function aclRuleCount(entries: Row[] | undefined, egress: boolean): string {
  const count = (entries ?? []).filter((entry: Row) => Boolean(entry.Egress) === egress).length;
  return count === 0 ? "—" : String(count);
}

/**
 * "Your VPCs", with the ID column linking to the detail page.
 *
 * The table itself is the shared definition. Only the VPC console has a VPC detail page,
 * so the link is added here rather than in the shared definition, where it would point at
 * a route the EC2 console does not have.
 */
const VPCS_WITH_DETAIL_LINK: ResourceDefinition = {
  ...EC2_API_RESOURCES.vpcs,
  columns: EC2_API_RESOURCES.vpcs.columns.map((column) =>
    column.id === "id"
      ? {
          ...column,
          cell: (row: Row) =>
            row.VpcId ? (
              <ResourceLink href={`/vpc/vpcs/${row.VpcId}`}>{row.VpcId}</ResourceLink>
            ) : (
              "-"
            ),
        }
      : column,
  ),
};

/**
 * Every table the VPC console routes, keyed by its `/vpc/:resource` path segment.
 *
 * The order here is the order the left navigation lists them in, which is AWS's order.
 */
export const VPC_RESOURCES: Record<string, ResourceDefinition> = {
  vpcs: VPCS_WITH_DETAIL_LINK,
  subnets: EC2_API_RESOURCES.subnets,
  "route-tables": EC2_API_RESOURCES["route-tables"],
  "internet-gateways": EC2_API_RESOURCES["internet-gateways"],
  "elastic-ips": EC2_API_RESOURCES["elastic-ips"],
  "managed-prefix-lists": VPC_ONLY_RESOURCES["managed-prefix-lists"],
  endpoints: VPC_ONLY_RESOURCES.endpoints,
  "nat-gateways": VPC_ONLY_RESOURCES["nat-gateways"],
  "network-acls": VPC_ONLY_RESOURCES["network-acls"],
  "security-groups": EC2_API_RESOURCES["security-groups"],
  "network-interfaces": EC2_API_RESOURCES["network-interfaces"],
};
