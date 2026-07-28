# LCS Microservice Draft

This page is the concrete split plan for moving the current single-process emulator into protocol-faithful service nodes behind one edge endpoint.

## Current Constraints

- The current runtime already supports per-service isolation through `FLOCI_SERVICES_<SERVICE>_ENABLED` flags.
- The current runtime already supports shared durable state at `/app/data` through `memory`, `persistent`, `hybrid`, and `wal` storage modes.
- The missing component is a protocol-aware edge that can route AWS Query, JSON 1.1, REST XML, and REST JSON traffic without rewriting request bytes.

## Phase 0: Keep Monolith As Oracle

- Keep the current single-container runtime as the compatibility oracle.
- Every microservice phase must pass the same AWS CLI, SDK, Terraform, CDK, and OpenTofu suites that the monolith passes.
- Do not change wire shapes just to make service routing easier.

## Service-By-Service Rollout Order

| Phase | Scope | Why this wave comes first | Exit gate |
|---|---|---|---|
| 0 | LCS rebrand, checklist system, compatibility baseline, edge contract | Gives one source of truth for naming, test evidence, and routing rules before process splits start | LCS checklist exists, service inventory is frozen, edge contract is documented, baseline suites stay green |
| 1 | IAM + STS | Smallest high-value identity boundary; many other services depend on it, but it has no Docker child-runtime burden | Query protocol parity, XML error parity, console inventory/detail pages, create user/role/access key flows, assume-role flows |
| 2 | S3 | Clear REST XML boundary, high business value, strong SDK and CLI coverage | Path-style and virtual-host style compatibility, bucket/object CRUD, tagging, versioning, presign, console list/detail flows |
| 3 | SQS + SNS + EventBridge + Scheduler + Pipes | Messaging fabric should stabilize before compute orchestration depends on it | Queue/topic/rule CRUD, publish/receive flows, delivery wiring, console inventory flows |
| 4 | EC2 + ELB v2 + Auto Scaling + Route53 | These services form one network and placement family; splitting EC2 alone too early creates cross-service churn | VPC/subnet/SG/instance lifecycle, ENI pagination, load balancer wiring, Auto Scaling reconciliation, DNS behaviors |
| 5 | Lambda + API Gateway v1 + API Gateway v2 + Step Functions | Compute orchestration depends on identity, storage, messaging, and core network primitives already being stable | Invoke flows, deployment flows, event sources, state-machine execution paths, console workflow pages |
| 6 | SSM + ec2messages + DynamoDB + DynamoDB Streams + Kinesis + Firehose + CloudWatch Logs + CloudWatch Metrics + AppConfig + AppConfigData + Secrets Manager + KMS | Shared state and observability layer for most business workflows | CRUD and streaming parity, event-source flows, metrics/log delivery, config fetch flows |
| 7 | RDS + ElastiCache + OpenSearch + MSK + ECS + ECR + EKS + Neptune + CodeBuild + CodeDeploy | Highest Docker/runtime coupling; best deferred until control-plane seams are already proven | Child-container lifecycle, host-port strategy, data durability, auth flows, build/deploy orchestration |
| 8 | Cognito + CloudFormation + ACM + Athena + Glue + SES + Backup + Config + CloudFront + Textract + Pricing + Cost Explorer + CUR + BCM Data Exports + Transfer + Bedrock Runtime + Transcribe | Long-tail services with varied protocol shapes and lower dependency pressure for the first waves | Service-specific compatibility packs and console pages exist with checklist evidence |

## Rules For Each Wave

- Only one service family becomes the active feature wave at a time.
- Every wave needs API parity, console parity, and at least one executable compatibility pack before the next wave starts.
- Every service gets a checklist file with business scenarios and evidence links.
- A checkbox is only marked done after an executable validation step passes.

## Phase 1: Edge Plus Single-Service Nodes

- `edge` owns port `4566` and the console surface.
- `iam`, `s3`, and `ec2` run the same application image, but each node enables only one business service.
- Shared state lives on one mounted volume at `/app/data`.
- Preferred storage mode for the first split is `wal` so every node has durable local state without synchronous write cost on every mutation.
- Single-writer rule: each node owns its own storage subtree. Do not rely on two nodes mutating the same files.
- `ec2` is the only node in this first cut that needs `/var/run/docker.sock`.
- Do not publish the EC2 SSH host range on the EC2 service container. Child instance containers bind those host ports directly on the Docker host.

### Edge Routing Rules

| Protocol family | Routing signal | Target node |
|---|---|---|
| EC2 Query | SigV4 service `ec2`; fallback on `Action=` body fields | `ec2` |
| IAM Query | SigV4 service `iam`; fallback on `Action=` body fields | `iam` |
| S3 REST XML | SigV4 service `s3`, bucket-style hostnames, and path-style bucket rules | `s3` |
| JSON 1.1 | `X-Amz-Target` prefix or SigV4 service name | owning service |
| Console / health | direct edge handling | `edge` |

The routing key order matters. Prefer SigV4 service detection first, then use protocol-specific fallbacks only when the request is unsigned or intentionally lax.

## Phase 2: Service RPC And Identity Handoff

- `edge` becomes the only public entrypoint.
- Service-to-service reads move from shared-file assumptions to explicit internal HTTP calls.
- Example flows:
  - `ec2 -> iam` for instance profile and role resolution.
  - `s3 -> iam` for policy evaluation.
  - `edge -> all nodes` for aggregated health and dashboard summaries.
- Add an internal request context header set for account ID, region, request ID, and caller identity.

## Phase 3: Shared Control Plane

- Extract account metadata, endpoint registry, auth cache, and async event delivery into shared control-plane components.
- Add contract tests for cross-service flows before enabling more services behind the edge.
- If shared-volume coordination becomes brittle, replace file-level sharing with an explicit storage API or a dedicated metadata store.

## Phase 4: Independent Packaging

- Split per-service images only after edge routing and service RPC contracts are stable.
- Keep the same public protocols, error shapes, and compatibility suites.
- Promote one service at a time behind the edge, with the monolith still available as a fallback oracle.

## Compose Draft

The root-level `docker-compose.microservices.yml` file is the concrete phase-1 topology draft.

- The `iam`, `s3`, and `ec2` nodes are already expressible with the current service-enable flags.
- The `edge` service in that file is still a target component. The current repository does not yet build a protocol-aware edge router.
- The compose draft deliberately keeps the default `docker-compose.yml` untouched so current single-container workflows stay stable.