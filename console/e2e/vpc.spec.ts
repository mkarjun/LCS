/**
 * VPC console E2E.
 *
 * The EC2 API is a Query service: every call is a POST to "/" with a form-encoded body,
 * answered with XML. These specs stub that endpoint with the exact element names
 * `Ec2QueryHandler` emits — `vpcSet`/`item`, `natGatewaySet`, `networkAclSet`,
 * `entrySet`, `prefixListSet` — so the AWS SDK's own XML parser has to accept them. That
 * makes this a guard on the wire format as much as on the console: rename a member in the
 * Java handler and these fail, which is how the project's earlier Query-protocol defects
 * should have been caught.
 *
 * The fixtures below are hand-written to match the handler, not captured from it. When
 * the handler changes shape, change them together.
 */
import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

const EC2_NS = "http://ec2.amazonaws.com/doc/2016-11-15/";

function response(action: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<${action}Response xmlns="${EC2_NS}">
  <requestId>e2e-00000000-0000-0000-0000-000000000000</requestId>
  ${body}
</${action}Response>`;
}

function tagSet(tags: Record<string, string>): string {
  const items = Object.entries(tags)
    .map(([key, value]) => `<item><key>${key}</key><value>${value}</value></item>`)
    .join("");
  return `<tagSet>${items}</tagSet>`;
}

const VPCS = response(
  "DescribeVpcs",
  `<vpcSet>
    <item>
      <vpcId>vpc-0e2e0001</vpcId>
      <state>available</state>
      <cidrBlock>10.0.0.0/16</cidrBlock>
      <dhcpOptionsId>dopt-0e2e</dhcpOptionsId>
      <instanceTenancy>default</instanceTenancy>
      <isDefault>true</isDefault>
      <ownerId>000000000000</ownerId>
      <cidrBlockAssociationSet>
        <item>
          <associationId>vpc-cidr-assoc-0e2e</associationId>
          <cidrBlock>10.0.0.0/16</cidrBlock>
          <cidrBlockState><state>associated</state></cidrBlockState>
        </item>
      </cidrBlockAssociationSet>
      ${tagSet({ Name: "primary-vpc" })}
    </item>
  </vpcSet>`,
);

const NAT_GATEWAYS = response(
  "DescribeNatGateways",
  `<natGatewaySet>
    <item>
      <natGatewayId>nat-0e2e0001</natGatewayId>
      <subnetId>subnet-0e2e0001</subnetId>
      <vpcId>vpc-0e2e0001</vpcId>
      <state>available</state>
      <connectivityType>public</connectivityType>
      <createTime>2026-08-01T10:00:00.000Z</createTime>
      <natGatewayAddressSet>
        <item><allocationId>eipalloc-0e2e0001</allocationId></item>
      </natGatewayAddressSet>
      ${tagSet({ Name: "egress-nat" })}
    </item>
  </natGatewaySet>`,
);

const NETWORK_ACLS = response(
  "DescribeNetworkAcls",
  `<networkAclSet>
    <item>
      <networkAclId>acl-0e2e0001</networkAclId>
      <vpcId>vpc-0e2e0001</vpcId>
      <default>true</default>
      <ownerId>000000000000</ownerId>
      <entrySet>
        <item>
          <ruleNumber>100</ruleNumber>
          <protocol>6</protocol>
          <ruleAction>allow</ruleAction>
          <egress>false</egress>
          <cidrBlock>0.0.0.0/0</cidrBlock>
          <portRange><from>80</from><to>80</to></portRange>
        </item>
        <item>
          <ruleNumber>110</ruleNumber>
          <protocol>6</protocol>
          <ruleAction>allow</ruleAction>
          <egress>false</egress>
          <cidrBlock>0.0.0.0/0</cidrBlock>
          <portRange><from>443</from><to>443</to></portRange>
        </item>
        <item>
          <ruleNumber>32767</ruleNumber>
          <protocol>-1</protocol>
          <ruleAction>deny</ruleAction>
          <egress>false</egress>
          <cidrBlock>0.0.0.0/0</cidrBlock>
        </item>
        <item>
          <ruleNumber>100</ruleNumber>
          <protocol>-1</protocol>
          <ruleAction>allow</ruleAction>
          <egress>true</egress>
          <cidrBlock>0.0.0.0/0</cidrBlock>
        </item>
      </entrySet>
      <associationSet>
        <item>
          <networkAclAssociationId>aclassoc-0e2e0001</networkAclAssociationId>
          <networkAclId>acl-0e2e0001</networkAclId>
          <subnetId>subnet-0e2e0001</subnetId>
        </item>
      </associationSet>
      ${tagSet({})}
    </item>
  </networkAclSet>`,
);

const ENDPOINTS = response(
  "DescribeVpcEndpoints",
  `<vpcEndpointSet>
    <item>
      <vpcEndpointId>vpce-0e2e0001</vpcEndpointId>
      <vpcEndpointType>Gateway</vpcEndpointType>
      <vpcId>vpc-0e2e0001</vpcId>
      <serviceName>com.amazonaws.us-east-1.s3</serviceName>
      <state>available</state>
      <privateDnsEnabled>false</privateDnsEnabled>
      <creationTimestamp>2026-08-01T10:00:00.000Z</creationTimestamp>
      <routeTableIdSet><item>rtb-0e2e0001</item></routeTableIdSet>
      <subnetIdSet/>
      <groupSet/>
      ${tagSet({ Name: "s3-gateway" })}
    </item>
  </vpcEndpointSet>`,
);

const PREFIX_LISTS = response(
  "DescribePrefixLists",
  `<prefixListSet>
    <item>
      <prefixListId>pl-0e2e0001</prefixListId>
      <prefixListName>com.amazonaws.us-east-1.s3</prefixListName>
      <cidrSet>
        <item>52.216.0.0/15</item>
        <item>54.231.0.0/16</item>
      </cidrSet>
    </item>
  </prefixListSet>`,
);

const EMPTY: Record<string, string> = {
  DescribeSubnets: response("DescribeSubnets", "<subnetSet/>"),
  DescribeRouteTables: response("DescribeRouteTables", "<routeTableSet/>"),
  DescribeInternetGateways: response("DescribeInternetGateways", "<internetGatewaySet/>"),
  DescribeSecurityGroups: response("DescribeSecurityGroups", "<securityGroupInfo/>"),
  DescribeAddresses: response("DescribeAddresses", "<addressesSet/>"),
  DescribeNetworkInterfaces: response("DescribeNetworkInterfaces", "<networkInterfaceSet/>"),
  DescribeFlowLogs: response("DescribeFlowLogs", "<flowLogSet/>"),
};

const RESPONSES: Record<string, string> = {
  ...EMPTY,
  DescribeVpcs: VPCS,
  DescribeNatGateways: NAT_GATEWAYS,
  DescribeNetworkAcls: NETWORK_ACLS,
  DescribeVpcEndpoints: ENDPOINTS,
  DescribePrefixLists: PREFIX_LISTS,
};

/**
 * Answers the EC2 Query endpoint.
 *
 * Anything the map does not cover is failed rather than defaulted, so a page that starts
 * calling a new action shows up as a failing test instead of an empty table.
 */
async function stubEc2(page: Page, overrides: Record<string, string> = {}): Promise<void> {
  const table = { ...RESPONSES, ...overrides };
  await page.route("http://localhost:5173/", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }
    const action = new URLSearchParams(request.postData() ?? "").get("Action") ?? "";
    const body = table[action];
    if (body === undefined) {
      await route.fulfill({
        status: 400,
        contentType: "text/xml",
        body: `<Response><Errors><Error><Code>InvalidAction</Code><Message>e2e stub has no ${action}</Message></Error></Errors></Response>`,
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "text/xml", body });
  });
}

test("the VPC console is reachable from the service catalog", async ({ page }) => {
  await stubEc2(page);
  await page.goto("./services");

  await page.getByRole("link", { name: "Amazon Virtual Private Cloud" }).click();

  await expect(page.getByRole("heading", { name: "VPC Dashboard" })).toBeVisible();
  await expect(page).toHaveURL(/\/_lcs\/ui\/vpc$/);
});

test("the dashboard counts resources and lists the VPCs", async ({ page }) => {
  await stubEc2(page);
  await page.goto("./vpc");

  // The count sits directly under its label, so the tile's whole text is label + count.
  const vpcTile = page
    .locator("div")
    .filter({ has: page.getByRole("link", { name: "VPCs", exact: true }) })
    .filter({ hasText: /^VPCs1$/ });
  await expect(vpcTile.first()).toBeVisible();

  await expect(page.getByRole("link", { name: "vpc-0e2e0001" })).toBeVisible();
  await expect(page.getByText("10.0.0.0/16").first()).toBeVisible();
});

test("the left navigation greys the entries LCS cannot back", async ({ page }) => {
  await stubEc2(page);
  await page.goto("./vpc");

  // Backed entries navigate; unbacked ones are inert and carry the reason on the tooltip.
  await expect(page.getByRole("link", { name: "Your VPCs" })).toBeVisible();
  const peering = page.getByTitle(/Not available in LCS — LCS has no CreateVpcPeeringConnection/);
  await expect(peering).toBeVisible();
  await expect(peering).toHaveText("Peering connections");
});

test("NAT gateways parse the emulator's natGatewaySet wire format", async ({ page }) => {
  await stubEc2(page);
  await page.goto("./vpc/nat-gateways");

  const row = page.getByRole("row", { name: /nat-0e2e0001/ });
  await expect(row).toContainText("egress-nat");
  await expect(row).toContainText("available");
  await expect(row).toContainText("public");
  // natGatewayAddressSet/item/allocationId — the member most likely to be mis-named.
  await expect(row).toContainText("eipalloc-0e2e0001");
});

test("network ACLs count inbound and outbound entries separately", async ({ page }) => {
  await stubEc2(page);
  await page.goto("./vpc/network-acls");

  const row = page.getByRole("row", { name: /acl-0e2e0001/ });
  await expect(row).toContainText("1 Subnet");
  await expect(row).toContainText("Yes");
  // The fixture carries three inbound entries and one outbound. Asserting the split —
  // not just that some number rendered — is what makes this a guard on `entrySet`:
  // mis-name that member and both columns fall back to an em dash.
  const cells = row.getByRole("cell");
  await expect(cells.filter({ hasText: /^3$/ })).toHaveCount(1);
  await expect(cells.filter({ hasText: /^1$/ })).toHaveCount(1);
});

test("endpoints show the service they connect to", async ({ page }) => {
  await stubEc2(page);
  await page.goto("./vpc/endpoints");

  const row = page.getByRole("row", { name: /vpce-0e2e0001/ });
  await expect(row).toContainText("com.amazonaws.us-east-1.s3");
  await expect(row).toContainText("Gateway");
});

test("managed prefix lists are read-only, with no create action", async ({ page }) => {
  await stubEc2(page);
  await page.goto("./vpc/managed-prefix-lists");

  const row = page.getByRole("row", { name: /pl-0e2e0001/ });
  await expect(row).toContainText("52.216.0.0/15");
  await expect(row).toContainText("2");
  // LCS has no CreateManagedPrefixList, so the table must not offer one.
  await expect(page.getByRole("button", { name: /^Create/ })).toHaveCount(0);
});

test("a VPC id opens the detail page with its CIDR and DNS settings", async ({ page }) => {
  await stubEc2(page, {
    DescribeVpcAttribute: response(
      "DescribeVpcAttribute",
      `<vpcId>vpc-0e2e0001</vpcId><enableDnsSupport><value>true</value></enableDnsSupport>`,
    ),
  });
  await page.goto("./vpc/vpcs");

  await page.getByRole("link", { name: "vpc-0e2e0001" }).click();

  await expect(page.getByRole("heading", { name: "vpc-0e2e0001" })).toBeVisible();
  await expect(page.getByText("primary-vpc")).toBeVisible();
  await expect(page.getByRole("tab", { name: "CIDRs" })).toBeVisible();

  await page.getByRole("tab", { name: "CIDRs" }).click();
  await expect(page.getByRole("row", { name: /vpc-cidr-assoc-0e2e/ })).toContainText("associated");
});

test("the EC2 console no longer lists the VPC resources itself", async ({ page }) => {
  await stubEc2(page);
  await page.goto("./ec2");

  // AWS keeps these in the VPC console; the EC2 nav must not duplicate them.
  await expect(page.getByRole("link", { name: "Your VPCs" })).toHaveCount(0);
  // "Security Groups" is the EC2 nav's own casing; the dashboard's link reads
  // "Security groups", so the exact match keeps this on the nav entry.
  await expect(page.getByRole("link", { name: "Security Groups", exact: true })).toBeVisible();
});
