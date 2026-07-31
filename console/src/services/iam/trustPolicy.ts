import type { SelectProps } from "@cloudscape-design/components/select";

/**
 * The service principals AWS lists in "Use case" on the create-role page, limited to
 * services this emulator actually runs. A role that trusts a service LCS does not
 * implement is not wrong — trust policies are not validated against a service registry —
 * but offering one implies a use case that cannot be exercised here.
 */
export const SERVICE_PRINCIPALS: SelectProps.Option[] = [
  { value: "lambda.amazonaws.com", label: "Lambda", description: "Allows Lambda functions to call AWS services on your behalf." },
  { value: "ec2.amazonaws.com", label: "EC2", description: "Allows EC2 instances to call AWS services on your behalf." },
  { value: "ecs-tasks.amazonaws.com", label: "Elastic Container Service Task", description: "Allows ECS tasks to call AWS services on your behalf." },
  { value: "ecs.amazonaws.com", label: "Elastic Container Service", description: "Allows ECS to create and manage AWS resources on your behalf." },
  { value: "apigateway.amazonaws.com", label: "API Gateway", description: "Allows API Gateway to push logs to CloudWatch Logs." },
  { value: "cloudformation.amazonaws.com", label: "CloudFormation", description: "Allows CloudFormation to create and manage stacks on your behalf." },
  { value: "states.amazonaws.com", label: "Step Functions", description: "Allows Step Functions to access AWS resources on your behalf." },
  { value: "events.amazonaws.com", label: "EventBridge", description: "Allows EventBridge to invoke targets on your behalf." },
  { value: "sns.amazonaws.com", label: "SNS", description: "Allows SNS to write delivery status logs." },
  { value: "sqs.amazonaws.com", label: "SQS", description: "Allows SQS to access AWS resources on your behalf." },
  { value: "dynamodb.amazonaws.com", label: "DynamoDB", description: "Allows DynamoDB to access AWS resources on your behalf." },
  { value: "rds.amazonaws.com", label: "RDS", description: "Allows RDS to access AWS resources on your behalf." },
  { value: "s3.amazonaws.com", label: "S3", description: "Allows S3 to call AWS services on your behalf." },
  { value: "ssm.amazonaws.com", label: "Systems Manager", description: "Allows Systems Manager to call AWS services on your behalf." },
  { value: "kinesis.amazonaws.com", label: "Kinesis", description: "Allows Kinesis to access AWS resources on your behalf." },
  { value: "firehose.amazonaws.com", label: "Data Firehose", description: "Allows Firehose to access AWS resources on your behalf." },
];

/** The trust policy AWS writes for a service role. */
export function serviceTrustPolicy(servicePrincipal: string): string {
  return JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: servicePrincipal },
          Action: "sts:AssumeRole",
        },
      ],
    },
    null,
    2,
  );
}

/**
 * The trust policy AWS writes for a cross-account role.
 *
 * The MFA condition and external ID are included when asked for, matching the two
 * checkboxes on AWS's "AWS account" option. LCS does not enforce either — `sts:AssumeRole`
 * does not evaluate the condition block — so they are written into the document for
 * fidelity rather than for protection.
 */
export function accountTrustPolicy(
  accountId: string,
  options: { requireMfa: boolean; externalId: string },
): string {
  const condition: Record<string, Record<string, string | boolean>> = {};
  if (options.requireMfa) {
    condition.Bool = { "aws:MultiFactorAuthPresent": "true" };
  }
  if (options.externalId.trim() !== "") {
    condition.StringEquals = { "sts:ExternalId": options.externalId.trim() };
  }
  return JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: `arn:aws:iam::${accountId}:root` },
          Action: "sts:AssumeRole",
          ...(Object.keys(condition).length > 0 ? { Condition: condition } : {}),
        },
      ],
    },
    null,
    2,
  );
}
