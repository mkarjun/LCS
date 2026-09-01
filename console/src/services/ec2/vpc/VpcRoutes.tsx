import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { recordVisit } from "@shell/recentlyVisited";
import { unavailableNavItem } from "@shell/navUnavailable";
import { useServiceNav } from "@shell/ServiceNavContext";
import VpcDashboardPage from "./VpcDashboardPage";
import VpcDetailPage from "./VpcDetailPage";
import VpcResourceListPage from "./VpcResourceListPage";

/**
 * VPC routes and left navigation.
 *
 * AWS serves the VPC console from the EC2 API, and so does LCS — which is why this module
 * lives under `services/ec2/` rather than beside it. Sharing the module keeps the resource
 * tables, create modals, and EC2 client in one place instead of importing across a service
 * boundary, and it is an accurate picture of the API underneath.
 *
 * The section names, their order, and the order of entries inside them were transcribed
 * from the live AWS VPC console on 2026-09-01, not from memory. Three corrections came out
 * of that pass and are worth stating because they are easy to get wrong again:
 *
 * - **Endpoints are not under "Virtual private cloud".** AWS moved them into
 *   "PrivateLink and Lattice", which is where a user now looks for them.
 * - **There is no "Network Analysis" section.** Reachability Analyzer and Network Access
 *   Analyzer moved out to AWS Network Manager.
 * - **Network interfaces are not in this nav at all.** They are an EC2 console entry.
 *
 * Entries backed by APIs LCS does not implement are greyed rather than dropped, so the
 * shape of the real console stays visible. Sections where nothing is backed are collapsed
 * by default, so the working entries are not buried under thirty dead ones.
 * See planning/ec2-domain-coverage.md.
 */
export default function VpcRoutes() {
  useEffect(() => recordVisit("vpc"), []);

  useServiceNav({
    title: "VPC",
    href: "/vpc",
    items: [
      { type: "link", text: "VPC dashboard", href: "/vpc" },
      {
        type: "section",
        text: "Virtual private cloud",
        defaultExpanded: true,
        items: [
          { type: "link", text: "Your VPCs", href: "/vpc/vpcs" },
          { type: "link", text: "Subnets", href: "/vpc/subnets" },
          { type: "link", text: "Route tables", href: "/vpc/route-tables" },
          { type: "link", text: "Internet gateways", href: "/vpc/internet-gateways" },
          unavailableNavItem(
            "Egress-only Internet gateways",
            "LCS has no CreateEgressOnlyInternetGateway API",
          ),
          unavailableNavItem("Carrier gateways", "LCS has no CreateCarrierGateway API"),
          unavailableNavItem("DHCP option sets", "LCS has no CreateDhcpOptions API"),
          { type: "link", text: "Elastic IPs", href: "/vpc/elastic-ips" },
          { type: "link", text: "Managed prefix lists", href: "/vpc/managed-prefix-lists" },
          { type: "link", text: "NAT gateways", href: "/vpc/nat-gateways" },
          unavailableNavItem("Peering connections", "LCS has no CreateVpcPeeringConnection API"),
          unavailableNavItem("Route servers", "LCS has no CreateRouteServer API"),
        ],
      },
      {
        type: "section",
        text: "Security",
        defaultExpanded: true,
        items: [
          { type: "link", text: "Network ACLs", href: "/vpc/network-acls" },
          { type: "link", text: "Security groups", href: "/vpc/security-groups" },
        ],
      },
      {
        type: "section",
        text: "PrivateLink and Lattice",
        defaultExpanded: true,
        items: [
          { type: "link", text: "Endpoints", href: "/vpc/endpoints" },
          unavailableNavItem(
            "Endpoint services",
            "LCS answers DescribeVpcEndpointServices with an empty list",
          ),
          unavailableNavItem("Service networks", "LCS does not emulate VPC Lattice"),
          unavailableNavItem("Lattice services", "LCS does not emulate VPC Lattice"),
          unavailableNavItem("Resource configurations", "LCS does not emulate VPC Lattice"),
          unavailableNavItem("Resource gateways", "LCS does not emulate VPC Lattice"),
          unavailableNavItem("Target groups", "LCS does not emulate VPC Lattice"),
        ],
      },
      {
        type: "section",
        text: "DNS firewall",
        defaultExpanded: false,
        items: [
          unavailableNavItem("Rule groups", "LCS does not emulate Route 53 Resolver DNS Firewall"),
          unavailableNavItem("Domain lists", "LCS does not emulate Route 53 Resolver DNS Firewall"),
        ],
      },
      {
        type: "section",
        text: "Network Firewall",
        defaultExpanded: false,
        items: [
          unavailableNavItem("Firewalls", "LCS does not emulate AWS Network Firewall"),
          unavailableNavItem("Firewall policies", "LCS does not emulate AWS Network Firewall"),
          unavailableNavItem(
            "Network Firewall rule groups",
            "LCS does not emulate AWS Network Firewall",
          ),
          unavailableNavItem(
            "TLS inspection configurations",
            "LCS does not emulate AWS Network Firewall",
          ),
        ],
      },
      {
        type: "section",
        text: "Virtual private network (VPN)",
        defaultExpanded: false,
        items: [
          unavailableNavItem("Customer gateways", "LCS has no CreateCustomerGateway API"),
          unavailableNavItem("Virtual private gateways", "LCS has no CreateVpnGateway API"),
          unavailableNavItem(
            "Site-to-site VPN concentrators",
            "LCS has no VPN concentrator API",
          ),
          unavailableNavItem("Site-to-Site VPN connections", "LCS has no CreateVpnConnection API"),
          unavailableNavItem("Client VPN endpoints", "LCS has no CreateClientVpnEndpoint API"),
        ],
      },
      {
        type: "section",
        text: "AWS Verified Access",
        defaultExpanded: false,
        items: [
          unavailableNavItem("Verified access instances", "LCS does not emulate Verified Access"),
          unavailableNavItem(
            "Verified access trust providers",
            "LCS does not emulate Verified Access",
          ),
          unavailableNavItem("Verified access groups", "LCS does not emulate Verified Access"),
          unavailableNavItem("Verified access endpoints", "LCS does not emulate Verified Access"),
        ],
      },
      {
        type: "section",
        text: "Transit gateways",
        defaultExpanded: false,
        items: [
          unavailableNavItem("Transit gateways", "LCS has no CreateTransitGateway API"),
          unavailableNavItem(
            "Transit gateway attachments",
            "LCS has no CreateTransitGatewayVpcAttachment API",
          ),
          unavailableNavItem(
            "Transit gateway policy tables",
            "LCS has no CreateTransitGatewayPolicyTable API",
          ),
          unavailableNavItem(
            "Transit gateway route tables",
            "LCS has no CreateTransitGatewayRouteTable API",
          ),
          unavailableNavItem(
            "Transit gateway multicast",
            "LCS has no CreateTransitGatewayMulticastDomain API",
          ),
        ],
      },
      {
        type: "section",
        text: "Traffic mirroring",
        defaultExpanded: false,
        items: [
          unavailableNavItem("Mirror sessions", "LCS has no CreateTrafficMirrorSession API"),
          unavailableNavItem("Mirror targets", "LCS has no CreateTrafficMirrorTarget API"),
          unavailableNavItem("Mirror filters", "LCS has no CreateTrafficMirrorFilter API"),
        ],
      },
    ],
  });

  return (
    <Routes>
      <Route index element={<VpcDashboardPage />} />
      <Route path="vpcs/:vpcId" element={<VpcDetailPage />} />
      <Route path=":resource" element={<VpcResourceListPage />} />
    </Routes>
  );
}
