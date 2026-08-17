# LCS — Local Cloud Services

**A free, local AWS emulator for development, testing, and CI.**
No account. No auth token. No feature gates. Point your tools at `localhost:4566`.

```bash
docker run -d --name lcs \
  -p 4566:4566 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -u root \
  mkarjun/lcs:latest
```

Then open the console at **http://localhost:4566/_lcs/ui/**

---

## Point your tools at it

```bash
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_DEFAULT_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test

aws s3 mb s3://my-bucket
aws dynamodb list-tables
```

Any region works. Credentials can be any non-empty values. Your existing AWS SDK,
CLI, Terraform, CDK, OpenTofu, or test suite keeps working unchanged.

## A real console, not a status page

LCS ships a browser console that talks to the emulator **through the AWS SDK for
JavaScript** — the same way the real AWS console talks to AWS. Every action is a
real signed AWS API call over the wire, so if a screen works, the SDK path works.

Ten services have AWS-replica surfaces with inventory, detail, and
create/edit/delete flows: **S3, EC2, IAM, Lambda, DynamoDB, SQS, SNS, CloudWatch
Logs, RDS, CloudFormation** — including an in-browser Lambda code editor that
deploys through `UpdateFunctionCode`.

A further 60 services are reachable over the API and CLI.

### Built-in CloudShell

A real shell in a container, reached from the console's top navigation, with the
AWS CLI already pointed at LCS and authenticated with temporary credentials from
LCS's own STS. No `aws configure`, no long-lived keys. Files in the home
directory persist across sessions.

## Real Docker where fidelity matters

Lambda, RDS, ECS, EC2, EKS, Neptune, ElastiCache, MSK, OpenSearch and CodeBuild
use real Docker-backed execution rather than shallow mocks. That is why the
Docker socket is mounted above — without it, those services cannot start their
containers.

**First use of one of those services downloads its backing image.** A first
Lambda invoke takes about a minute while it pulls the Python runtime; every
invoke after that is a couple of seconds. This is normal and only happens once.

## What to expect on a first run

Measured on a machine with an empty Docker cache:

| | |
|---|---|
| Image download | ~348 MB |
| `docker run` → console answering | ~8 seconds |
| First Lambda invoke | ~60 s (pulls runtime image), ~2 s thereafter |

## Tags

| Tag | What it is |
|---|---|
| `latest` | Current release |
| `0.1.0` | Pinned version |

**Currently `linux/amd64` only.** Multi-arch images including `linux/arm64` are
built by the release pipeline and will land in a following release.

## Configuration

| | |
|---|---|
| Persist data across restarts | mount a volume at `/app/data` |
| Different port | publish to another host port |
| Reachable RDS databases | publish `7000-7019` |

> LCS has **no authentication** and accepts any credentials, so anything that can
> reach the port can drive it — including starting containers on the host, since
> the Docker socket is mounted. Publish it on `127.0.0.1` only, unless you are on
> a network you control.

## Installers

There are native installers for Windows and Linux that set up Docker if it is
missing, put an `lcs` command on your PATH, and start the emulator:

```
lcs up | lcs down | lcs status | lcs logs | lcs console
```

## Licence

Apache-2.0. LCS is built on the [Floci](https://github.com/floci-io/floci)
codebase, which is MIT-licensed; the upstream copyright and licence text are
preserved in the repository's `NOTICE` and `LICENSES/`.
