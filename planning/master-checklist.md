# LCS Master Checklist

This file is the execution tracker for turning the current emulator into LCS.

## Rules

- Only mark a checkbox done after an executable validation step passes.
- The canonical service inventory is [docs/services/index.md](../docs/services/index.md).
- The canonical rollout order is [docs/configuration/microservices.md](../docs/configuration/microservices.md).
- The console acceptance bar is defined in [aws-console-parity.md](aws-console-parity.md).
- Every service wave must cover API parity, AWS visual and behavioral console parity, and a dedicated 30-scenario business pack per service.
- Cross-service business flows belong to one primary service pack and must reference dependent services in notes or evidence.
- `Floci` removal is a staged migration. Do not break runtime compatibility just to rename strings.
- LCS may expand beyond AWS emulation later. Keep service packs provider-scoped so future Azure or Oracle work can follow the same structure.

## Completed Baseline

- [x] Microservice draft added in [docs/configuration/microservices.md](../docs/configuration/microservices.md).
- [x] Draft topology added in [docker-compose.microservices.yml](../docker-compose.microservices.yml).
- [x] Draft topology resolves with `docker compose config`.
- [x] Java 25 containerized compile passes.
- [x] EC2 Terraform response-shape suite passes.
- [x] EC2 network-interface pagination suite passes.
- [x] IAM Query compatibility baseline suite passes.
- [x] STS Query compatibility baseline suite passes.
- [x] LCS master checklist created.
- [x] Service checklist template created.
- [x] Seed service checklists created for EC2, IAM, STS, and S3.
- [x] Planning workspace created and trackers moved out of the repo root.
- [x] LCS rebrand policy documented.
- [x] `LCS_*` and `lcs.*` compatibility aliases added for the existing `floci.*` config model.

## Phase Checklist

### Phase 0: Foundation

- [x] Create master checklist and service checklist template.
- [x] Freeze service inventory from the current emulator.
- [x] Document service-by-service rollout order.
- [x] Introduce LCS naming policy and staged compatibility rules.
- [x] Add `LCS_*` config alias plan while preserving existing `FLOCI_*` compatibility.
- [ ] Define edge-router contract for Query, JSON 1.1, REST XML, and REST JSON services.
- [ ] Add checklist evidence links for every finished scenario.

### Phase 1: Identity Wave

- [ ] Harden IAM Query parity.
- [ ] Harden STS Query parity.
- [ ] Deliver IAM and STS console surfaces with AWS-matching UX evidence.
- [ ] Pass IAM and STS 30-scenario packs end to end.

### Phase 2: Object Storage Wave

- [ ] Harden S3 REST XML parity.
- [ ] Deliver S3 console parity with AWS-matching UX evidence.
- [ ] Pass S3 30-scenario pack end to end.

### Phase 3: Messaging Wave

- [ ] Harden SQS parity.
- [ ] Harden SNS parity.
- [ ] Harden EventBridge, Scheduler, and Pipes parity.
- [ ] Deliver messaging console parity.
- [ ] Pass per-service 30-scenario packs for the messaging wave.

### Phase 4: Network And Compute Control Plane

- [ ] Harden EC2 parity beyond current validated slices.
- [ ] Harden ELB v2 parity.
- [ ] Harden Auto Scaling parity.
- [ ] Harden Route53 parity.
- [ ] Deliver console parity for the full wave.
- [ ] Pass per-service 30-scenario packs for the network and compute wave.

### Phase 5: Compute Integration Wave

- [ ] Harden Lambda parity.
- [ ] Harden API Gateway v1 parity.
- [ ] Harden API Gateway v2 parity.
- [ ] Harden Step Functions parity.
- [ ] Deliver console parity for the full wave.
- [ ] Pass per-service 30-scenario packs for the compute integration wave.

### Phase 6: State And Observability Wave

- [ ] Harden SSM and ec2messages parity.
- [ ] Harden DynamoDB and Streams parity.
- [ ] Harden Kinesis and Firehose parity.
- [ ] Harden CloudWatch Logs and Metrics parity.
- [ ] Harden AppConfig, AppConfigData, Secrets Manager, and KMS parity.
- [ ] Deliver console parity for the full wave.
- [ ] Pass per-service 30-scenario packs for the state and observability wave.

### Phase 7: Container-Backed Wave

- [ ] Harden RDS parity.
- [ ] Harden ElastiCache parity.
- [ ] Harden OpenSearch parity.
- [ ] Harden MSK parity.
- [ ] Harden ECS, ECR, and EKS parity.
- [ ] Harden Neptune, CodeBuild, and CodeDeploy parity.
- [ ] Deliver console parity for the full wave.
- [ ] Pass per-service 30-scenario packs for the container-backed wave.

### Phase 8: Long-Tail Services

- [ ] Harden Cognito parity.
- [ ] Harden CloudFormation parity.
- [ ] Harden ACM, Athena, Glue, and SES parity.
- [ ] Harden Backup, Config, CloudFront, and Transfer parity.
- [ ] Harden Textract, Pricing, CE, CUR, BCM Data Exports, Bedrock Runtime, and Transcribe parity.
- [ ] Deliver console parity for the full wave.
- [ ] Pass per-service 30-scenario packs for the long-tail wave.

## Service Coverage

### Phase 1

- [ ] [IAM](services/iam.md)
- [ ] [STS](services/sts.md)

### Phase 2

- [ ] [S3](services/s3.md)

### Phase 3

- [ ] SQS
- [ ] SNS
- [ ] EventBridge
- [ ] EventBridge Scheduler
- [ ] EventBridge Pipes

### Phase 4

- [ ] [EC2](services/ec2.md)
- [ ] ELB v2
- [ ] Auto Scaling
- [ ] Route53

### Phase 5

- [ ] Lambda
- [ ] API Gateway v1
- [ ] API Gateway v2
- [ ] Step Functions

### Phase 6

- [ ] SSM
- [ ] ec2messages
- [ ] DynamoDB
- [ ] DynamoDB Streams
- [ ] Kinesis
- [ ] Firehose
- [ ] CloudWatch Logs
- [ ] CloudWatch Metrics
- [ ] AppConfig
- [ ] AppConfigData
- [ ] Secrets Manager
- [ ] KMS

### Phase 7

- [ ] RDS
- [ ] ElastiCache
- [ ] OpenSearch
- [ ] MSK
- [ ] ECS
- [ ] ECR
- [ ] EKS
- [ ] Neptune
- [ ] CodeBuild
- [ ] CodeDeploy

### Phase 8

- [ ] Cognito
- [ ] CloudFormation
- [ ] ACM
- [ ] Athena
- [ ] Glue
- [ ] SES
- [ ] SES v2
- [ ] Backup
- [ ] Config
- [ ] CloudFront
- [ ] Textract
- [ ] Pricing
- [ ] Cost Explorer
- [ ] Cost and Usage Reports
- [ ] BCM Data Exports
- [ ] Transfer Family
- [ ] Bedrock Runtime
- [ ] Transcribe

## Scenario Pack Policy

- Every service owns 30 business scenarios scoped to that service.
- Cross-service flows count once, under the service that owns the user workflow.
- A service is not complete until API parity, console parity, and all 30 scenarios are evidence-backed.
- Console parity means AWS-matching layout density, labels, navigation order, table behavior, form validation, empty states, loading states, and destructive-flow UX, while still carrying LCS branding.

## Seed Service Packs

- [services/ec2.md](services/ec2.md)
- [services/iam.md](services/iam.md)
- [services/sts.md](services/sts.md)
- [services/s3.md](services/s3.md)
- [services/SERVICE_TEMPLATE.md](services/SERVICE_TEMPLATE.md)