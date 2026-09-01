import type { InternetGateway, NatGateway, RouteTable, Subnet } from "@aws-sdk/client-ec2";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { nameTag } from "../useEc2Client";

/**
 * The VPC console's "Resource map" tab.
 *
 * AWS lays this out as four columns — VPC, Subnets grouped by Availability Zone, Route
 * tables, Network Connections — each holding a labelled chip per resource, with lines
 * drawn between related chips. The columns and chips are here; **the connector lines are
 * not**. They are the interesting half, and drawing them properly means measuring rendered
 * chip positions and painting an SVG overlay that survives resize and theme changes. That
 * is a real piece of work and is deliberately deferred rather than faked with a static
 * diagram that would go wrong the moment the data did.
 *
 * A subnet with no route to an internet or NAT gateway is private; AWS marks the
 * distinction with a coloured dot, and so does this.
 */

interface VpcResourceMapProps {
  vpcName: string;
  subnets: Subnet[];
  routeTables: RouteTable[];
  internetGateways: InternetGateway[];
  natGateways: NatGateway[];
}

/** A resource chip: the bordered, rounded label AWS draws for each node in the map. */
function Chip({ label, dot }: { label: string; dot?: "public" | "private" }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 10px",
        border: "1px solid var(--awsui-color-border-divider-default, #b6bec9)",
        borderRadius: "8px",
        background: "var(--awsui-color-background-container-content, transparent)",
      }}
    >
      {dot !== undefined && (
        <span
          aria-hidden="true"
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            flexShrink: 0,
            background:
              dot === "public"
                ? "var(--awsui-color-text-status-success, #037f0c)"
                : "var(--awsui-color-text-status-info, #0972d3)",
          }}
        />
      )}
      <Box variant="span">{label}</Box>
    </div>
  );
}

function MapColumn({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Container header={<Header variant="h3" description={description}>{title}</Header>}>
      <SpaceBetween size="xs">{children}</SpaceBetween>
    </Container>
  );
}

function empty(text: string) {
  return (
    <Box variant="p" color="text-body-secondary">
      {text}
    </Box>
  );
}

/** A subnet is public when its route table sends 0.0.0.0/0 at an internet gateway. */
function isPublic(subnet: Subnet, routeTables: RouteTable[]): boolean {
  const associated = routeTables.find((table) =>
    (table.Associations ?? []).some((association) => association.SubnetId === subnet.SubnetId),
  );
  const main = routeTables.find((table) =>
    (table.Associations ?? []).some((association) => association.Main),
  );
  const effective = associated ?? main;
  return (effective?.Routes ?? []).some(
    (route) => route.GatewayId?.startsWith("igw-") === true && route.DestinationCidrBlock === "0.0.0.0/0",
  );
}

function label(id: string | undefined, tags: { Key?: string; Value?: string }[] | undefined): string {
  const name = nameTag(tags);
  return name === "—" ? (id ?? "") : name;
}

export function VpcResourceMap({
  vpcName,
  subnets,
  routeTables,
  internetGateways,
  natGateways,
}: VpcResourceMapProps) {
  // AWS groups the subnet column by Availability Zone, with the zone as a subheading.
  const zones = [...new Set(subnets.map((subnet) => subnet.AvailabilityZone ?? "—"))].sort();

  const connections = [
    ...internetGateways.map((gateway) => label(gateway.InternetGatewayId, gateway.Tags)),
    ...natGateways.map((gateway) => label(gateway.NatGatewayId, gateway.Tags)),
  ];

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="How this VPC's subnets, route tables, and gateways relate to each other."
        >
          Resource map
        </Header>
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
          alignItems: "start",
        }}
      >
        <MapColumn title="VPC" description="Your AWS virtual network">
          <Chip label={vpcName} />
        </MapColumn>

        <MapColumn title={`Subnets (${subnets.length})`} description="Subnets within this VPC">
          {subnets.length === 0
            ? empty("No subnets in this VPC.")
            : zones.map((zone) => (
                <SpaceBetween key={zone} size="xxs">
                  <Box variant="awsui-key-label">{zone}</Box>
                  {subnets
                    .filter((subnet) => (subnet.AvailabilityZone ?? "—") === zone)
                    .map((subnet) => (
                      <Chip
                        key={subnet.SubnetId}
                        label={label(subnet.SubnetId, subnet.Tags)}
                        dot={isPublic(subnet, routeTables) ? "public" : "private"}
                      />
                    ))}
                </SpaceBetween>
              ))}
        </MapColumn>

        <MapColumn
          title={`Route tables (${routeTables.length})`}
          description="Route network traffic to resources"
        >
          {routeTables.length === 0
            ? empty("No route tables in this VPC.")
            : routeTables.map((table) => (
                <Chip key={table.RouteTableId} label={label(table.RouteTableId, table.Tags)} />
              ))}
        </MapColumn>

        <MapColumn
          title={`Network Connections (${connections.length})`}
          description="Connections to other networks"
        >
          {connections.length === 0
            ? empty("No internet or NAT gateways attached.")
            : connections.map((connection) => <Chip key={connection} label={connection} />)}
        </MapColumn>
      </div>
    </Container>
  );
}
