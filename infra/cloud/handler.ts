import { createCloudDevRuntime } from "./runtime";

export const handler = createCloudDevRuntime(process.env);
