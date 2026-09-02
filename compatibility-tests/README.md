# floci-compatibility-tests

Compatibility test suite for [Floci](https://github.com/hectorvent/floci) — a local AWS emulator.

Verifies that standard AWS tooling (SDKs, CDK, OpenTofu/Terraform) works correctly against the emulator without modification. Tests run against a live Floci instance and use real AWS SDK clients — no mocks.

## Quick Start

```bash
# Install just (task runner)
# macOS: brew install just
# Linux: cargo install just

# Copy and configure environment
cp env.example .env

# Install dependencies
just setup

# Run all tests
just test-all

# Run specific SDK tests
just test-python
just test-typescript
just test-awscli
```

## Test Runners

| Module                                | Language       | Test Framework | Command                |
| ------------------------------------- | -------------- | -------------- | ---------------------- |
| [`sdk-test-python`](sdk-test-python/) | Python 3       | pytest         | `just test-python`     |
| [`sdk-test-node`](sdk-test-node/)     | TypeScript     | vitest         | `just test-typescript` |
| [`sdk-test-awscli`](sdk-test-awscli/) | Bash / AWS CLI | bats-core      | `just test-awscli`     |
| [`sdk-test-java`](sdk-test-java/)     | Java 17        | JUnit 5        | `just test-java`       |
| [`sdk-test-go`](sdk-test-go/)         | Go 1.24        | go test        | `just test-go`         |

### IaC Compatibility

| Module                                  | Tool       | Command    |
| --------------------------------------- | ---------- | ---------- |
| [`compat-cdk`](compat-cdk/)             | AWS CDK v2 | `./run.sh` |
| [`compat-opentofu`](compat-opentofu/)   | OpenTofu   | `./run.sh` |
| [`compat-terraform`](compat-terraform/) | Terraform  | `./run.sh` |

## Prerequisites

- **Floci running** on `http://localhost:4566` (or set `FLOCI_ENDPOINT`)
- **Docker** — required for Lambda invocation tests
- **just** — task runner for orchestration

Per-module requirements:

| Module            | Requirements                        |
| ----------------- | ----------------------------------- |
| `sdk-test-python` | Python 3.9+, pip                    |
| `sdk-test-node`   | Node.js 20+, npm, vitest            |
| `sdk-test-awscli` | AWS CLI v2, bash, jq                |
| `sdk-test-java`   | Java 17+, Maven                     |
| `sdk-test-go`     | Go 1.24+                            |

## Setup

```bash
# Setup all SDKs
just setup

# Setup individual SDKs
just setup-python      # pip install -r requirements.txt
just setup-typescript  # npm install
just setup-awscli      # Clone bats-core, bats-support, bats-assert
```

## Running Tests

### All SDKs

```bash
just test-all
```

### Individual SDKs

```bash
# Python (pytest)
just test-python

# TypeScript (vitest)
just test-typescript

# AWS CLI (bats-core)
just test-awscli
```

Bats-based suites keep their normal console output and also write JUnit XML reports:

- `sdk-test-awscli/test-results/junit.xml`
- `compat-cdk/test-results/junit.xml`
- `compat-terraform/test-results/junit.xml`
- `compat-opentofu/test-results/junit.xml`

## Configuration

All modules read from environment variables (see `.env.example`):

```bash
FLOCI_ENDPOINT=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_DEFAULT_REGION=us-east-1
```

## Running with Docker

Each module includes a `Dockerfile` for isolated execution:

```bash
# Python
docker build -t floci-sdk-python sdk-test-python/
docker run --rm --network host floci-sdk-python pytest

# TypeScript
docker build -t floci-sdk-node sdk-test-node/
docker run --rm --network host floci-sdk-node npm test
```

On macOS/Windows, use `host.docker.internal` instead of `localhost`:

```bash
docker run --rm -e FLOCI_ENDPOINT=http://host.docker.internal:4566 floci-sdk-python pytest
```

## Exit Codes

All test runners exit `0` on full pass and non-zero if any test fails — suitable for CI pipelines.

## Running the suites locally

```bash
./run-local.sh lcs:compat                 # all eight
./run-local.sh lcs:compat sdk-test-node   # one
```

Build the image first: `docker build -f ../docker/Dockerfile -t lcs:compat ..`

This exists because `.github/workflows/compatibility.yml` triggers only on
`pull_request` with path filters — work pushed straight to `main` never runs it. Use this
to get a green run against the tip of main before a release.

Findings from the first full local run (2026-09-02) worth knowing before you start:

- **`sdk-test-java` needs a public DNS resolver.** The test container takes the emulator's
  embedded DNS so `*.floci` wildcard subdomains resolve, but that DNS only answers for its
  own names. The image pre-fetches with `dependency:go-offline`, yet Surefire resolves its
  *own plugin* dependencies when the test goal runs and reaches for Maven Central
  mid-suite. `run-local.sh` adds a fallback resolver; without it the suite dies with
  "Unknown host repo.maven.apache.org" and looks like a product failure.
- **`compat-cdk` cannot pass on Docker Desktop.** CDK pushes a container asset to
  `<account>.dkr.ecr.<region>.localhost:5100`. That push runs on the host daemon, and the
  `.localhost` name does not resolve there on Windows or macOS. Linux CI is fine.
- **One Node test sits close to its timeout.** `S3 > should multipart copy object with
  non-ASCII key` took 54s against a 60s limit, and failed outright at 90s on a loaded
  machine. It is not slow in isolation — the same sequence runs in ~600ms from inside a
  container on the same network, and ~180ms from the host. The cost is contention from
  Vitest running 34 files in parallel while Neptune, DocDB, RDS and ECR tests each launch
  real containers. Treat a failure there as suite load, not as an S3 defect, but it is
  worth raising that test's timeout.
- Each suite writes `/results/junit.xml`, so `run-local.sh` gives each its own results
  directory. Sharing one silently leaves you with only the last suite's report.
