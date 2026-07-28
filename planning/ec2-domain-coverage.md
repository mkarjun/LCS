# EC2 and Adjacent Domain Coverage

Answers: "does LCS provide everything in the EC2 / networking / storage / security /
operations domain?"

**Short answer: no.** LCS emulates 53 services. Large parts of the EC2 domain — especially
advanced networking, capacity/fleet management, and hybrid — are not emulated at all.

## Method

Every row below was **probed against a running emulator** (`lcs/lcs:console`,
2026-07-28), not taken from documentation. Classification:

| Result | Meaning |
|---|---|
| **Supported** | Returned a valid, well-formed response |
| **Op unsupported** | Service is routed, but returns `UnsupportedOperation` |
| **Not emulated** | No route at all — falls through to S3 and returns `NoSuchBucket` |
| **Stub** | Routed and returns HTTP 200, but with an empty body; shape unverified |

Two probe bugs were found and fixed while producing this table, so earlier numbers should
not be trusted:

1. Unemulated services fall through to the S3 catch-all and return `NoSuchBucket`. A naive
   "did it error?" check reads that as success — it briefly reported **EFS as supported**,
   which is wrong.
2. The AWS CLI validates parameters client-side. A probe using a fake instance id never
   reaches the emulator, so it proves nothing.

## EC2 core

| Feature | Status |
|---|---|
| EC2 instances (run/start/stop/terminate/describe) | Supported (real Docker containers) |
| Instance types | Supported |
| AMIs (DescribeImages) | Supported |
| Key pairs | Supported |
| Elastic IPs | Supported |
| User data | Supported |
| IMDS | Supported |
| Launch templates | Op unsupported |
| Spot instances / Spot fleet / EC2 Fleet | Op unsupported |
| Dedicated hosts / dedicated instances | Op unsupported |
| Capacity reservations | Op unsupported |
| Placement groups | Op unsupported |
| EC2 Image Builder | Not emulated |
| EC2 Instance Connect | Unverified — needs a live instance to test |
| EC2 Serial Console | Not emulated |
| Hibernation, Nitro, Nitro Enclaves | Not emulated |

## Networking

| Feature | Status |
|---|---|
| VPCs, Subnets, Route tables, Internet gateways | Supported |
| Security groups | Supported |
| Network interfaces (ENI) | Supported |
| NAT gateways, Egress-only IGW | Op unsupported |
| Network ACLs | Op unsupported |
| VPC peering, VPC endpoints, PrivateLink | Op unsupported |
| Transit Gateway, VGW, Site-to-Site VPN, Client VPN | Op unsupported |
| Prefix lists, DHCP option sets, Flow logs, IPAM | Op unsupported |
| Direct Connect, VPC Lattice, Traffic Mirroring | Not emulated |
| Reachability / Network Access Analyzer | Not emulated |

## Load balancing and scaling

| Feature | Status |
|---|---|
| ELBv2 (ALB / NLB), target groups, listeners | Supported |
| Auto Scaling groups | Supported |
| Launch configurations | Supported |
| Classic ELB (v1) | Stub — HTTP 200 with an empty body |
| Gateway Load Balancer | Unverified |

## Storage

| Feature | Status |
|---|---|
| EBS volumes | Supported |
| EBS snapshots | Op unsupported |
| Snapshot archive / FSR / Multi-Attach | Not emulated |
| Instance store | Not emulated |
| EFS | **Not emulated** |

## DNS and edge

| Feature | Status |
|---|---|
| Route 53 hosted zones and record sets | Supported |
| Route 53 health checks | Supported |
| CloudFront | Stub — HTTP 200 with an empty body |
| Global Accelerator | Op unsupported |

## Security

| Feature | Status |
|---|---|
| IAM (users, roles, policies, instance profiles) | Supported |
| KMS | Supported |
| Secrets Manager | Supported |
| ACM | Supported |
| Shield, WAF, Firewall Manager | Op unsupported |

## Monitoring and operations

| Feature | Status |
|---|---|
| CloudWatch metrics and alarms | Supported |
| CloudWatch Logs | Supported |
| AWS Config | Supported |
| SSM Parameter Store | Supported |
| SSM Run Command | Supported |
| SSM Session Manager | Op unsupported |
| CloudTrail | Op unsupported |
| SSM Patch/State Manager, Fleet Manager, OpsCenter | Not verified; likely unsupported |

## Deployment, backup, discovery, hybrid

| Feature | Status |
|---|---|
| CloudFormation | Supported |
| CodeDeploy | Supported |
| AWS Backup | Supported |
| Elastic Beanstalk | Op unsupported |
| DataSync, Cloud Map, Application Migration, DRS | Op unsupported / not emulated |
| Outposts, Local Zones, Wavelength | Not emulated |

## What this means for the console

The console can only be an honest replica of what the backend actually does. Two rules
follow:

1. **Build console surfaces only for supported operations.** An EC2 console with a
   "Launch templates" page that always errors is worse than no page.
2. **Where AWS's console shows a nav item LCS cannot back, either omit it or mark it
   unavailable.** Do not render a page that looks functional and is not.

So the EC2 console scope is: **Instances (+ detail tabs), AMIs, Instance Types, Volumes,
Key Pairs, Elastic IPs, Security Groups, Network Interfaces, VPCs, Subnets, Route Tables,
Internet Gateways, Load Balancers, Target Groups, Auto Scaling Groups.**

Everything else in the AWS EC2 left nav (Launch Templates, Spot Requests, Capacity
Reservations, Dedicated Hosts, Placement Groups, Snapshots, Lifecycle Manager) is
**backend work first, console second**.
