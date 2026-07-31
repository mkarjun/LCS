import {
  AttachRolePolicyCommand,
  CreateRoleCommand,
  GetRoleCommand,
} from "@aws-sdk/client-iam";
import type { IAMClient } from "@aws-sdk/client-iam";

/** The managed policy AWS attaches to every basic Lambda execution role. */
export const BASIC_EXECUTION_POLICY_ARN =
  "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";

/** The trust policy that lets Lambda assume the role. Without it the function cannot run. */
const LAMBDA_TRUST_POLICY = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: "sts:AssumeRole",
    },
  ],
});

/** AWS names a generated role `<function>-role-<8 hex chars>`. */
function suggestRoleName(functionName: string): string {
  const suffix = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
  // IAM role names cap at 64 characters, so the function part is trimmed, not the suffix —
  // the suffix is what keeps repeat creations from colliding.
  const prefix = functionName.slice(0, 64 - "-role-".length - suffix.length);
  return `${prefix}-role-${suffix}`;
}

export interface CreatedExecutionRole {
  roleName: string;
  roleArn: string;
  /** False when the basic-execution policy could not be attached. */
  policyAttached: boolean;
}

/**
 * Creates the execution role AWS creates for you when you leave "Create a new role with
 * basic Lambda permissions" selected in the create-function form.
 *
 * `CreateFunction` requires a role ARN — in LCS as in real AWS — and the AWS console papers
 * over that by calling IAM first. Without this the console cannot create a function at all
 * in a fresh account, because there are no roles to pick from.
 *
 * A role name collision is retried once with a fresh suffix; beyond that the caller sees
 * the IAM error.
 */
export async function createBasicExecutionRole(
  iam: IAMClient,
  functionName: string,
): Promise<CreatedExecutionRole> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const roleName = suggestRoleName(functionName);
    try {
      const created = await iam.send(
        new CreateRoleCommand({
          RoleName: roleName,
          AssumeRolePolicyDocument: LAMBDA_TRUST_POLICY,
          Description: `Execution role for the ${functionName} Lambda function, created by the LCS console.`,
        }),
      );
      let policyAttached = true;
      try {
        await iam.send(
          new AttachRolePolicyCommand({
            RoleName: roleName,
            PolicyArn: BASIC_EXECUTION_POLICY_ARN,
          }),
        );
      } catch {
        // The role still works for invocation; only CloudWatch Logs permission is missing.
        policyAttached = false;
      }
      return {
        roleName,
        // CreateRole always returns the ARN, but fall back rather than send undefined.
        roleArn:
          created.Role?.Arn ??
          (await iam.send(new GetRoleCommand({ RoleName: roleName }))).Role?.Arn ??
          "",
        policyAttached,
      };
    } catch (cause) {
      lastError = cause;
      const code = (cause as { name?: string }).name;
      if (code !== "EntityAlreadyExists" && code !== "EntityAlreadyExistsException") {
        throw cause;
      }
    }
  }
  throw lastError;
}
