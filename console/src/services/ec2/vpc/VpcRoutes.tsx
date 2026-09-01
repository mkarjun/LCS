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
 * The nav mirrors the AWS VPC console's grouping. Entries backed by APIs LCS does not
 * implement — peering connections, DHCP option sets, egress-only and carrier gateways,
 * transit gateways, the analyzers, DNS firewall, Network Firewall, and every VPN entry —
 * are shown greyed rather than dropped, so the shape of the real console is visible and it
 * is obvious what this emulator covers. See planning/ec2-domain-coverage.md.
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
            "Egress-only internet gateways",
            "LCS has no CreateEgressOnlyInternetGateway API",
          ),
          unavailableNavItem("Carrier gateways", "LCS has no CreateCarrierGateway API"),
          unavailableNavItem("DHCP option sets", "LCS has no CreateDhcpOptions API"),
          { type: "link", text: "Elastic IPs", href: "/vpc/elastic-ips" },
          { type: "link", text: "Managed prefix lists", href: "/vpc/managed-prefix-lists" },
          { type: "link", text: "Endpoints", href: "/vpc/endpoints" },
          unavailableNavItem(
            "Endpoint services",
            "LCS answers DescribeVpcEndpointServices with an empty list",
          ),
          { type: "link", text: "NAT gateways", href: "/vpc/nat-gateways" },
          unavailableNavItem("Peering connections", "LCS has no CreateVpcPeeringConnection API"),
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
        text: "Network Analysis",
        defaultExpanded: false,
        items: [
          unavailableNavItem("Reachability Analyzer", "LCS has no Reachability Analyzer API"),
          unavailableNavItem("Network Access Analyzer", "LCS has no Network Access Analyzer API"),
        ],
      },
      {
        type: "section",
        text: "Virtual private network (VPN)",
        defaultExpanded: false,
        items: [
          unavailableNavItem("Customer gateways", "LCS has no CreateCustomerGateway API"),
          unavailableNavItem("Virtual private gateways", "LCS has no CreateVpnGateway API"),
          unavailableNavItem("Site-to-Site VPN connections", "LCS has no CreateVpnConnection API"),
          unavailableNavItem("Client VPN endpoints", "LCS has no CreateClientVpnEndpoint API"),
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
        ],
      },
      {
        type: "section",
        text: "Network Firewall",
        defaultExpanded: false,
        items: [
          unavailableNavItem("Firewalls", "LCS does not emulate AWS Network Firewall"),
          unavailableNavItem("Firewall policies", "LCS does not emulate AWS Network Firewall"),
          unavailableNavItem("DNS Firewall rule groups", "LCS does not emulate Route 53 Resolver DNS Firewall"),
        ],
      },
      {
        type: "link",
        text: "Network interfaces",
        href: "/vpc/network-interfaces",
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
