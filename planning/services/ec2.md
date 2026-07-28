# EC2 Service Pack

## Scope

- Service: EC2
- Phase: 4
- Protocol: EC2 Query
- Owner wave: Network and compute control plane

## API Parity

- [x] Terraform-required instance response fields are present for a launched instance.
- [x] `DescribeNetworkInterfaces` pagination behaves correctly for `MaxResults` and `NextToken`.
- [ ] VPC, subnet, route table, and internet gateway workflows are validated end to end.
- [ ] Security-group rule lifecycle is validated end to end.
- [ ] Address allocation and association workflows are validated end to end.
- [ ] Tagging and filtering behaviors are validated end to end.
- [ ] AWS-compatible error envelopes are validated across malformed and not-found cases.

## Console Parity

- [ ] Inventory page matches AWS EC2 inventory layout and table behavior.
- [ ] Instance detail page matches AWS information hierarchy and actions.
- [ ] VPC and subnet inventory pages are evidence-backed against AWS UX.
- [ ] Security-group inventory and detail pages are evidence-backed against AWS UX.
- [ ] Elastic IP, route table, and network-interface pages are evidence-backed against AWS UX.

## 30 Business Scenarios

- [x] Scenario 01: Launch a single instance and verify Terraform-required response fields.
- [x] Scenario 02: Paginate network interfaces and verify `NextToken` continuation.
- [ ] Scenario 03: Create VPC, subnet, security group, key pair, and launch instances.
- [ ] Scenario 04: Stop, start, reboot, and terminate instances with AWS-like state transitions.
- [ ] Scenario 05: Allocate and associate an Elastic IP to an instance.
- [ ] Scenario 06: Attach internet gateway and route table for public routing.
- [ ] Scenario 07: Create, revoke, and describe security-group rules.
- [ ] Scenario 08: Describe instances, tags, and filters across multiple resources.
- [ ] Scenario 09: Validate malformed IDs and not-found IDs return AWS-compatible errors.
- [ ] Scenario 10: Validate console inventory and detail pages against API state.
- [ ] Scenario 11: Create AMI from an instance and describe the resulting image.
- [ ] Scenario 12: Launch with user data and verify delivery to the instance.
- [ ] Scenario 13: Launch with an instance profile and verify credential availability.
- [ ] Scenario 14: Create, attach, detach, and delete EBS volumes.
- [ ] Scenario 15: Create, describe, and delete snapshots.
- [ ] Scenario 16: Create and describe key pairs with AWS-shaped material handling.
- [ ] Scenario 17: Apply tags at launch and verify downstream filter behavior.
- [ ] Scenario 18: Create and describe route tables with subnet associations.
- [ ] Scenario 19: Create and describe internet gateways with attachments.
- [ ] Scenario 20: Create and describe elastic network interfaces directly.
- [ ] Scenario 21: Modify instance attributes and verify describe output.
- [ ] Scenario 22: Create and apply launch templates.
- [ ] Scenario 23: Authorize and revoke egress rules with AWS-compatible defaults.
- [ ] Scenario 24: Allocate multiple Elastic IPs and filter them correctly.
- [ ] Scenario 25: Describe instance status and state-reason transitions.
- [ ] Scenario 26: Create DHCP options and associate them with a VPC.
- [ ] Scenario 27: Create network ACLs and validate rule ordering.
- [ ] Scenario 28: Create placement groups and launch into them.
- [ ] Scenario 29: Validate console row actions, bulk actions, and refresh behavior.
- [ ] Scenario 30: Validate AWS-like pagination, column persistence, and search behavior in the console.

## Evidence

- Validation command: `./mvnw.cmd --% -f compatibility-tests/sdk-test-java/pom.xml -q -Dtest=Ec2InstanceResponseShapeTest,Ec2NetworkInterfacePaginationTest test`
- Test file or suite: `compatibility-tests/sdk-test-java/src/test/java/com/floci/test/Ec2InstanceResponseShapeTest.java`, `compatibility-tests/sdk-test-java/src/test/java/com/floci/test/Ec2NetworkInterfacePaginationTest.java`
- Runtime URL or environment: Local Maven-driven validation against the default emulator runtime.
- Notes: The terminated-instance ENI leak was fixed by excluding ENIs from terminated instances in `DescribeNetworkInterfaces`.