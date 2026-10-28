import {
  readCloudStackCreateRequestProjection,
  cloudStackCreateRequestInput,
} from "../../infra/cloud/stack-create-request.ts";
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 1024 * 1024) throw Error("synthetic request bound");
}
const value = JSON.parse(input),
  projection = readCloudStackCreateRequestProjection(
    value.json,
    value.expected,
  );
let unavailable = false;
try {
  cloudStackCreateRequestInput(projection);
} catch {
  unavailable = true;
}
process.stdout.write(
  JSON.stringify({
    projectionRead: true,
    materialUnavailable: unavailable,
    resourceWrites: projection.resourceWrites,
  }) + "\n",
);
