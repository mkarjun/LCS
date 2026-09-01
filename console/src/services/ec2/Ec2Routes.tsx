import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { recordVisit } from "@shell/recentlyVisited";
import { useServiceNav } from "@shell/ServiceNavContext";
import Ec2DashboardPage from "./Ec2DashboardPage";
import InstancesPage from "./InstancesPage";
import InstanceDetailPage from "./InstanceDetailPage";
import ResourceListPage from "./ResourceListPage";

/**
 * EC2 routes and left navigation.
 *
 * The nav mirrors the AWS EC2 console's grouping, but only lists resources LCS can
 * actually serve. AWS entries backed by unsupported APIs — Launch Templates, Spot
 * Requests, Savings Plans, Reserved Instances, Dedicated Hosts, Capacity Reservations,
 * Placement Groups, Snapshots, Lifecycle Manager — are omitted rather than rendered as
 * links that always error. See planning/ec2-domain-coverage.md.
 *
 * VPCs, subnets, route tables, and internet gateways are not here: AWS puts them in the
 * VPC console and so does LCS now. Their `/ec2/...` routes still resolve so older links
 * keep working, but the nav sends people to `/vpc`, which is where AWS sends them.
 */
export default function Ec2Routes() {
  useEffect(() => recordVisit("ec2"), []);

  useServiceNav({
    title: "EC2",
    href: "/ec2",
    items: [
      { type: "link", text: "Dashboard", href: "/ec2" },
      {
        type: "section",
        text: "Instances",
        defaultExpanded: true,
        items: [
          { type: "link", text: "Instances", href: "/ec2/instances" },
          { type: "link", text: "Instance Types", href: "/ec2/instance-types" },
        ],
      },
      {
        type: "section",
        text: "Images",
        defaultExpanded: true,
        items: [{ type: "link", text: "AMIs", href: "/ec2/amis" }],
      },
      {
        type: "section",
        text: "Elastic Block Store",
        defaultExpanded: true,
        items: [{ type: "link", text: "Volumes", href: "/ec2/volumes" }],
      },
      {
        type: "section",
        text: "Network & Security",
        defaultExpanded: true,
        items: [
          { type: "link", text: "Security Groups", href: "/ec2/security-groups" },
          { type: "link", text: "Elastic IPs", href: "/ec2/elastic-ips" },
          { type: "link", text: "Key Pairs", href: "/ec2/key-pairs" },
          { type: "link", text: "Network Interfaces", href: "/ec2/network-interfaces" },
        ],
      },
      {
        type: "section",
        text: "Load Balancing",
        defaultExpanded: true,
        items: [
          { type: "link", text: "Load Balancers", href: "/ec2/load-balancers" },
          { type: "link", text: "Target Groups", href: "/ec2/target-groups" },
          { type: "link", text: "Listeners", href: "/ec2/listeners" },
        ],
      },
      {
        type: "section",
        text: "Auto Scaling",
        defaultExpanded: true,
        items: [
          { type: "link", text: "Auto Scaling Groups", href: "/ec2/auto-scaling-groups" },
          { type: "link", text: "Launch Configurations", href: "/ec2/launch-configurations" },
        ],
      },
    ],
  });

  return (
    <Routes>
      <Route index element={<Ec2DashboardPage />} />
      <Route path="instances" element={<InstancesPage />} />
      <Route path="instances/:instanceId" element={<InstanceDetailPage />} />
      <Route path=":resource" element={<ResourceListPage />} />
    </Routes>
  );
}
