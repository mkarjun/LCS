# IAM Service Pack

## Scope

- Service: IAM
- Phase: 1
- Protocol: AWS Query
- Owner wave: Identity

## API Parity

- [ ] IAM user CRUD matches AWS Query behavior.
- [ ] IAM role CRUD matches AWS Query behavior.
- [x] Managed policy attach and detach flows match AWS behavior.
- [x] Access-key lifecycle matches AWS behavior.
- [x] Instance-profile flows match AWS behavior.
- [ ] Query XML errors match AWS-compatible structures.
- [ ] Pagination, filtering, and duplicate-entity behaviors are validated.

## Console Parity

- [ ] Users inventory page matches AWS IAM inventory layout and actions.
- [ ] Groups inventory page matches AWS IAM information hierarchy.
- [ ] Roles inventory and detail pages match AWS UX and action ordering.
- [ ] Policies inventory and attach flows match AWS UX closely.
- [ ] Instance profile surfaces and destructive flows match AWS UX closely.

## 30 Business Scenarios

- [ ] Scenario 01: Create user, list user, and delete user.
- [x] Scenario 02: Create role with trust policy and read it back.
- [x] Scenario 03: Attach managed policy to user and list attachments.
- [x] Scenario 04: Attach managed policy to role and list attachments.
- [x] Scenario 05: Create access key and list access keys.
- [x] Scenario 06: Create instance profile, add role, and read it back.
- [ ] Scenario 07: Put inline user policy and read it back.
- [ ] Scenario 08: Put inline role policy and read it back.
- [ ] Scenario 09: Create group, add user, and list group members.
- [ ] Scenario 10: Remove user from group and delete the group cleanly.
- [ ] Scenario 11: Detach managed policy from user and verify state.
- [ ] Scenario 12: Detach managed policy from role and verify state.
- [ ] Scenario 13: Delete role with attachments returns AWS-compatible error shape.
- [ ] Scenario 14: Create login profile and validate update behavior.
- [ ] Scenario 15: Update access-key status and reflect it in list responses.
- [ ] Scenario 16: Delete access key and verify cleanup.
- [ ] Scenario 17: Tag user and filter readback correctly.
- [ ] Scenario 18: Tag role and filter readback correctly.
- [ ] Scenario 19: Create managed policy and read default version metadata.
- [ ] Scenario 20: Create policy version and switch default version.
- [ ] Scenario 21: Delete non-default policy version with AWS-compatible guards.
- [ ] Scenario 22: List attached user policies with pagination.
- [ ] Scenario 23: List attached role policies with pagination.
- [ ] Scenario 24: List instance profiles for role and validate detach behavior.
- [ ] Scenario 25: Duplicate entity errors match AWS naming and codes.
- [ ] Scenario 26: Missing entity errors match AWS naming and codes.
- [ ] Scenario 27: Malformed policy documents return AWS-compatible validation errors.
- [ ] Scenario 28: Console create-user flow reflects in API state.
- [ ] Scenario 29: Console create-role and attach-policy flow reflects in API state.
- [ ] Scenario 30: Console policy detach and delete flows reflect in API state.

## Evidence

- Validation command: `set JAVA_HOME=C:\Program Files\Java\jdk-20` and `set FLOCI_ENDPOINT=http://127.0.0.1:4567` then `./mvnw.cmd --% -f compatibility-tests/sdk-test-java/pom.xml -q -Dtest=IamTest test`
- Test file or suite: `compatibility-tests/sdk-test-java/src/test/java/com/floci/test/IamTest.java`
- Runtime URL or environment: Local runtime on `http://127.0.0.1:4567`.
- Notes: `IamTest` passed 31/31 in 15.272s. Scenario boxes above are only marked where the existing evidence directly pins the user-facing workflow.