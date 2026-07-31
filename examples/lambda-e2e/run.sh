#!/usr/bin/env bash
#
# End-to-end Lambda example against a running LCS instance.
#
# Exercises the pieces the LCS console's Lambda screens drive:
#   1. create a function with environment variables (+ an execution role)
#   2. a direct invoke that returns the env-var values      (env vars work)
#   3. an SQS trigger via event source mapping              (trigger fires)
#   4. an async on-success / on-failure destination config  (config round-trips)
#
# It asserts each step and exits non-zero on the first failure, so it doubles as a smoke
# test. Requires: awscli v2, python3 (to build the zip), and LCS on :4566.
#
# Usage:
#   ./run.sh                 # against https://localhost:4566 (FLOCI_TLS_ENABLED=true)
#   ENDPOINT=http://localhost:4566 ./run.sh
#
set -euo pipefail

ENDPOINT="${ENDPOINT:-https://localhost:4566}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
# Git Bash on Windows rewrites /aws/... paths; disable that for log-group names.
export MSYS_NO_PATHCONV=1

# --no-verify-ssl for the self-signed cert LCS serves when FLOCI_TLS_ENABLED=true.
TLS_FLAG=()
[[ "$ENDPOINT" == https://* ]] && TLS_FLAG=(--no-verify-ssl)
aws_() { aws --endpoint-url "$ENDPOINT" --region "$REGION" "${TLS_FLAG[@]}" "$@" 2>/dev/null; }

SFX="$RANDOM"
FN="e2e-fn-$SFX"; SRC="e2e-src-$SFX"; OK="e2e-success-$SFX"; FAIL="e2e-fail-$SFX"; ROLE="e2e-role-$SFX"
# Run from the script's own directory and use relative paths, so native Windows aws.exe /
# python.exe (which don't understand MSYS /c/... paths) find the files.
cd "$(dirname "$0")"

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; exit 1; }

echo "==> Building deployment package"
# Pick a working python. On Windows, `python3` is often a Store stub that only prints a
# message, so each candidate is test-run before it is accepted.
PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "import zipfile" >/dev/null 2>&1; then
    PY="$cand"; break
  fi
done
[[ -n "$PY" ]] || fail "python3 (or python) is required to build the zip"
"$PY" -c "import zipfile; z=zipfile.ZipFile('handler.zip','w',zipfile.ZIP_DEFLATED); z.write('handler.js','index.js'); z.close()"

echo "==> Creating execution role"
aws_ iam create-role --role-name "$ROLE" \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
aws_ iam attach-role-policy --role-name "$ROLE" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole || true
ROLE_ARN="arn:aws:iam::000000000000:role/$ROLE"

echo "==> Creating function with environment variables"
aws_ lambda create-function --function-name "$FN" --runtime nodejs20.x --role "$ROLE_ARN" \
  --handler index.handler --zip-file "fileb://handler.zip" \
  --environment 'Variables={GREETING=EchoBot,APP_STAGE=prod}' >/dev/null
sleep 2

echo "==> 1. Environment variables (direct invoke)"
aws_ lambda invoke --function-name "$FN" \
  --payload "$(printf '{"hi":"there"}' | base64 | tr -d '\n')" "out.json" >/dev/null
grep -q '"greeting":"EchoBot"' "out.json" && grep -q '"stage":"prod"' "out.json" \
  && pass "invoke response carried env vars: $(cat "out.json")" \
  || fail "env vars not reflected: $(cat "out.json")"

echo "==> Creating queues"
SRC_URL=$(aws_ sqs create-queue --queue-name "$SRC" --query QueueUrl --output text)
OK_URL=$(aws_ sqs create-queue --queue-name "$OK" --query QueueUrl --output text)
FAIL_URL=$(aws_ sqs create-queue --queue-name "$FAIL" --query QueueUrl --output text)
SRC_ARN=$(aws_ sqs get-queue-attributes --queue-url "$SRC_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
OK_ARN=$(aws_ sqs get-queue-attributes --queue-url "$OK_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
FAIL_ARN=$(aws_ sqs get-queue-attributes --queue-url "$FAIL_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

echo "==> 2. Trigger (SQS event source mapping)"
ESM=$(aws_ lambda create-event-source-mapping --function-name "$FN" --event-source-arn "$SRC_ARN" --batch-size 5 --query 'State' --output text)
[[ -n "$ESM" ]] && pass "event source mapping created (state: $ESM)" || fail "ESM not created"

echo "==> 3. Destination config (on-success / on-failure)"
aws_ lambda put-function-event-invoke-config --function-name "$FN" \
  --destination-config "OnSuccess={Destination=$OK_ARN},OnFailure={Destination=$FAIL_ARN}" >/dev/null
GOT_OK=$(aws_ lambda get-function-event-invoke-config --function-name "$FN" --query 'DestinationConfig.OnSuccess.Destination' --output text)
[[ "$GOT_OK" == "$OK_ARN" ]] && pass "destination config round-tripped ($GOT_OK)" || fail "destination config mismatch: $GOT_OK"

echo "==> 4. Fire the trigger: send a message to the source queue"
aws_ sqs send-message --queue-url "$SRC_URL" --message-body "order-42" >/dev/null
printf '   waiting for the poller'
for _ in $(seq 1 15); do
  DEPTH=$(aws_ sqs get-queue-attributes --queue-url "$SRC_URL" --attribute-names ApproximateNumberOfMessages --query 'Attributes.ApproximateNumberOfMessages' --output text)
  [[ "$DEPTH" == "0" ]] && break
  printf '.'; sleep 2
done
echo
[[ "$DEPTH" == "0" ]] && pass "source queue drained — the trigger invoked the function" || fail "message not consumed (depth=$DEPTH)"

echo "==> 5. Confirm the triggered invoke ran with the env var (logs)"
LG="/aws/lambda/$FN"
STREAM=$(aws_ logs describe-log-streams --log-group-name "$LG" --order-by LastEventTime --descending --max-items 1 --query 'logStreams[0].logStreamName' --output text)
if aws_ logs get-log-events --log-group-name "$LG" --log-stream-name "$STREAM" --query 'events[].message' --output text | grep -q "EchoBot \[prod\]: processed sqs record"; then
  pass "log shows the SQS-triggered invoke using the env var"
else
  fail "expected log line not found"
fi

echo
echo "All checks passed. Function: $FN"
echo
echo "NOTE: async destination *delivery* (records written to the OnSuccess/OnFailure"
echo "queues) is not emulated by LCS yet — only the destination configuration is stored"
echo "and returned. This example asserts the config round-trip, not delivery."
