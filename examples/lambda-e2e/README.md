# Lambda end-to-end example

A runnable, self-checking example that exercises the Lambda features the LCS console's
Lambda screens drive — **environment variables**, an **SQS trigger** (event source
mapping), and an **async destination** configuration — end to end against a running LCS
instance.

It mirrors the classic "queue → function" tutorial: a message dropped on an SQS queue is
picked up by an event source mapping and processed by the function, which reads its
behaviour from environment variables.

## Run

Start LCS with the Docker socket (needed for the Lambda runtime):

```bash
docker run -d --name lcs \
  -p 4566:4566 \
  -e FLOCI_TLS_ENABLED=true \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -u root \
  lcs/lcs:latest
```

Then:

```bash
cd examples/lambda-e2e
./run.sh
# or against a plain-HTTP instance:
ENDPOINT=http://localhost:4566 ./run.sh
```

Requires `awscli` v2 and `python3` (used only to build the deployment zip).

## What it checks

| Step | What it proves | API |
|---|---|---|
| 1 | Environment variables reach the runtime | `CreateFunction` (Environment) + `Invoke` |
| 2 | An SQS trigger can be attached | `CreateEventSourceMapping` |
| 3 | On-success / on-failure destinations are stored | `PutFunctionEventInvokeConfig` + `GetFunctionEventInvokeConfig` |
| 4 | The trigger actually invokes the function | `SendMessage` → source queue drains to 0 |
| 5 | The triggered invoke used the env var | CloudWatch Logs contains `EchoBot [prod]: processed sqs record` |

Each step prints `PASS` / `FAIL`; the script exits non-zero on the first failure, so it
works as a smoke test in CI.

## Known limitation

LCS stores and returns async **destination configuration** but does not yet **deliver**
records to the on-success / on-failure targets on an asynchronous invoke. This example
therefore asserts the config round-trip (step 3), not delivery. When delivery lands, add a
step that asserts a record arrives on the success queue after an `InvocationType=Event`
invoke.
