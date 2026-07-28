# STS Service Pack

## Scope

- Service: STS
- Phase: 1
- Protocol: AWS Query
- Owner wave: Identity

## API Parity

- [x] `GetCallerIdentity` matches AWS behavior.
- [x] `AssumeRole` returns AWS-shaped temporary credentials.
- [x] Assumed-role credentials are usable against a downstream AWS-style service flow.
- [ ] Query XML errors match AWS-compatible structures.
- [ ] Session policy intersection, duration limits, and external-id behavior are validated.
- [ ] Regional endpoint behavior and caller identity edge cases are validated.

## Console Parity

- [ ] LCS avoids inventing non-AWS STS console surfaces.
- [ ] Any identity helper or credential-helper surface uses AWS naming and flow order.
- [ ] Caller identity helper flow is evidence-backed.
- [ ] Assume-role helper flow is evidence-backed.
- [ ] Validation and failure copy match AWS language closely.

## 30 Business Scenarios

- [x] Scenario 01: `GetCallerIdentity` works against signed requests.
- [x] Scenario 02: `AssumeRole` returns usable temporary credentials.
- [x] Scenario 03: Assumed-role credentials can call S3 `ListBuckets` when policy allows.
- [ ] Scenario 04: Assumed-role credentials are denied when no downstream policy allows access.
- [ ] Scenario 05: Session name is preserved in the assumed-role ARN shape.
- [ ] Scenario 06: Duration seconds outside AWS limits returns AWS-compatible validation errors.
- [ ] Scenario 07: Missing role ARN returns AWS-compatible validation errors.
- [ ] Scenario 08: Missing session name returns AWS-compatible validation errors.
- [ ] Scenario 09: Invalid trust policy prevents role assumption with AWS-compatible errors.
- [ ] Scenario 10: External ID is required and enforced when configured in the trust policy.
- [ ] Scenario 11: Session policy narrows permissions below the role policy.
- [ ] Scenario 12: Role chaining behavior matches AWS constraints.
- [ ] Scenario 13: Caller identity works for assumed-role credentials.
- [ ] Scenario 14: Expired temporary credentials fail with AWS-compatible error shape.
- [ ] Scenario 15: Regional STS endpoint choice is honored consistently.
- [ ] Scenario 16: AssumeRole on a missing role returns AWS-compatible error shape.
- [ ] Scenario 17: AssumeRole with malformed policy JSON returns AWS-compatible validation error.
- [ ] Scenario 18: Response XML namespaces and element ordering match AWS expectations.
- [ ] Scenario 19: Session tags are accepted and reflected where AWS does.
- [ ] Scenario 20: Transitive session tags are enforced consistently.
- [ ] Scenario 21: Source identity is accepted and validated consistently.
- [ ] Scenario 22: MFA-required trust policies are enforced consistently.
- [ ] Scenario 23: AssumeRole response credentials work against IAM signed calls.
- [ ] Scenario 24: AssumeRole response credentials work against SQS signed calls.
- [ ] Scenario 25: Console helper for caller identity is evidence-backed.
- [ ] Scenario 26: Console helper for assume-role flow is evidence-backed.
- [ ] Scenario 27: CLI default retry behavior against STS errors matches AWS-compatible envelopes.
- [ ] Scenario 28: SDK v2 assume-role credential provider refreshes successfully.
- [ ] Scenario 29: SDK v1 assume-role credential provider refreshes successfully.
- [ ] Scenario 30: Cross-service assumed-role smoke pack passes with AWS-shaped responses.

## Evidence

- Validation command: `set JAVA_HOME=C:\Program Files\Java\jdk-20` and `set FLOCI_ENDPOINT=http://127.0.0.1:4567` then `./mvnw.cmd --% -f compatibility-tests/sdk-test-java/pom.xml -q -Dtest=StsTest test`
- Test file or suite: `compatibility-tests/sdk-test-java/src/test/java/com/floci/test/StsTest.java`
- Runtime URL or environment: Local runtime on `http://127.0.0.1:4567`.
- Notes: `StsTest` passed 18/18 in 1.914s. Additional downstream-role evidence comes from `IamEnforcementTest` passing 6/6 against a rebuilt runtime with IAM enforcement enabled.