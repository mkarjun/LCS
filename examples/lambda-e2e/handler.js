// LCS Lambda end-to-end example handler.
//
// Reads its behaviour from environment variables and handles two invoke shapes:
//   * a direct (RequestResponse) invoke — returns a JSON body
//   * an SQS event-source-mapping batch — logs one line per record
//
// The environment variables (GREETING, APP_STAGE) prove that configuration set on the
// function reaches the running runtime, and the log lines prove the SQS trigger actually
// invoked the function.

const GREETING = process.env.GREETING || "hello";
const APP_STAGE = process.env.APP_STAGE || "unset";

exports.handler = async (event) => {
  if (event && Array.isArray(event.Records)) {
    for (const record of event.Records) {
      console.log(`${GREETING} [${APP_STAGE}]: processed sqs record -> ${record.body}`);
    }
    return { batchItemFailures: [] };
  }
  console.log(`${GREETING} [${APP_STAGE}]: direct invoke -> ${JSON.stringify(event)}`);
  return { greeting: GREETING, stage: APP_STAGE, echo: event };
};
