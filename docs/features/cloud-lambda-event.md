# Lambda HTTP payload-v2 transport

## Requirement and PR boundary

[Issue 21](https://github.com/devsandip/peel/issues/21), split from [issue 13](https://github.com/devsandip/peel/issues/13), implements bounded HTTP transport for FR-04/14/20 and AC-12/13. Separating transport from authenticated DynamoDB composition keeps each PR reviewable. No product scope is added. This adapter wraps an explicitly supplied trusted Fetch handler; it configures no authentication policy, listener or AWS resource by itself.

## Plan before extraction

1. Require a configured HTTPS origin and accept only API Gateway HTTP payload-v2 input. Preserve raw query duplicates. Bound URL, headers, cookies and body; reject malformed paths, duplicate headers, conflicting cookie sources, noncanonical base64, invalid UTF-8, length mismatch and GET/HEAD bodies before calling the service.
2. Preserve cookie entries and duplicate-session detection for the authentication layer. Ignore event identity/forwarded-host metadata; construct URLs only from the configured origin. The dependent composition PR supplies the actual verified service.
3. Bound response reading and emit explicit v2 status, headers, body and separate cookies. Force no-store, retain retry headers and return private errors without logging request or upstream details.
4. Verify malformed/boundary input never calls the service. Test actual Fetch requests/responses, raw duplicates, Unicode/base64, cookie preservation, status/header mapping, response-stream cancellation and private failures. Run shared checks/build and hosted gates before merge.

## Limits and remaining gates

Provisional limits: 10 KiB path/query, 64 header entries and 16 KiB combined headers/cookies, 8 KiB per header/cookie set, 32 cookie entries, and 2 MiB decoded request/response. Unsupported/ambiguous events fail closed. Root-mounted routes and [AWS payload format 2.0](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html) are explicit requirements for future IaC. Real gateway mappings, proxy/CORS/CSP policy, IAM, cost/budget, throttling, deployment and application acceptance remain open. This transport does not establish authenticated Cloud access.

## Evidence

Four focused groups pass with actual Fetch requests/responses. Invalid/oversized input never enters the service. Passing cases preserve UTF-8/base64 text, raw duplicate query values, duplicate cookie entries, pinned origin despite forged host/identity metadata, retry status/headers and separate response cookies. An oversized response stream is cancelled; private service failures return only a fixed error. Response Unicode and its leading BOM survive conversion.

TypeScript, source formatting, all 134 shared cases in 26 files, all 22 existing DynamoDB Local cases and the unchanged production web build pass. The browser bundle retains its size warning. Hosted checks remain pending; actual results are recorded in the linked PR/issue. The service in these transport tests is synthetic, so they establish no authentication, real API Gateway invocation or managed-service acceptance. The dependent composition branch has separate synthetic RSA/DynamoDB tests and will be reviewed independently.
