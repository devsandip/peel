// Creates only one preflighted disposable M0 stack and always attempts owned-stack teardown.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, rm, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join, relative } from "node:path";
import { createServer } from "node:http";
import { build } from "vite";
import { chromium } from "@playwright/test";
import { relayTemplate } from "../infra/relay/template.ts";
import { renderBootstrap } from "../infra/relay/bootstrap.ts";
import {
  validateRun,
  validateRelayTemplate,
  parseLease,
} from "../infra/relay/guards.ts";
import { runDisposable } from "../infra/relay/lifecycle.ts";

const execute = promisify(execFile),
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const folder = resolve(process.argv[2] || "");
if (
  !/^relay-r[a-z0-9]+-[0-9a-f]{6}$/.test(relative(resolve("scratch"), folder))
)
  throw new Error("Use one private prepared relay folder");
const plan = JSON.parse(await readFile(join(folder, "plan.json"), "utf8"));
const template = JSON.parse(
  await readFile(join(folder, "template.json"), "utf8"),
);
const cutoff = Date.parse(process.env.PEEL_RELAY_CUTOFF || "");
if (
  !Number.isFinite(cutoff) ||
  Date.parse(plan.terminateAt) + 10 * 60000 > cutoff
)
  throw new Error("An explicit cutoff with cleanup headroom is required");
const apply = process.argv[3] === "--apply";
if (process.argv.length > 4 || (process.argv[3] && !apply))
  throw new Error("Unrecognized relay argument");
const privateWrite = async (name, value) => {
  const path = join(folder, name);
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
};
let lastOperation = "preflight",
  createConfirmed = false,
  createRejected = false,
  stackId,
  outputs,
  health;
let state = {
  stage: "preflight",
  stackName: `peel-m0-turn-${plan.runId}`,
  accountId: plan.accountId,
  region: plan.region,
  resourcesCreated: false,
  cleanupVerified: false,
};
const aws = async (args) => {
  lastOperation = `${args[0]}-${args[1]}`;
  try {
    const { stdout } = await execute(
      "aws",
      [
        "--profile",
        "admin",
        "--region",
        "us-east-1",
        "--no-cli-pager",
        "--cli-connect-timeout",
        "5",
        "--cli-read-timeout",
        "15",
        ...args,
        "--output",
        "json",
      ],
      { timeout: 25000, maxBuffer: 4 * 1024 * 1024 },
    );
    return stdout.trim() ? JSON.parse(stdout) : {};
  } catch (error) {
    const missing = /does not exist|not found|InvocationDoesNotExist/i.test(
      String(error.stderr),
    );
    const safe = new Error(
      `AWS ${lastOperation} ${missing ? "not-found" : "unavailable"}`,
    );
    safe.missing = missing;
    safe.awsCode = String(error.stderr).match(
      /\(([A-Za-z0-9_.]+)\) when calling/,
    )?.[1];
    throw safe;
  }
};
const identity = await aws(["sts", "get-caller-identity"]);
const pin = JSON.parse(
  await readFile("scratch/aws-development-identity.json", "utf8"),
);
if (identity.Account !== pin.identity.Account)
  throw new Error("AWS account no longer matches the private pin");
const clientIp = (
  await (
    await fetch("https://checkip.amazonaws.com", {
      signal: AbortSignal.timeout(10000),
    })
  ).text()
).trim();
validateRun(plan, { accountId: identity.Account, clientIp, now: Date.now() });
validateRelayTemplate(template);
const rendered = relayTemplate(
  renderBootstrap(
    await readFile("infra/relay/bootstrap.sh", "utf8"),
    await readFile("infra/relay/lease.py", "utf8"),
    await readFile("infra/relay/health.py", "utf8"),
  ),
);
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
if (
  hash(template) !== plan.templateHash ||
  hash(rendered) !== plan.templateHash
)
  throw new Error("Prepared template differs from current reviewed sources");
const validation = JSON.parse(
  await readFile(join(folder, "validation.json"), "utf8"),
);
if (
  validation.resourcesCreated !== 0 ||
  !validation.capabilities.includes("CAPABILITY_IAM")
)
  throw new Error("Missing prepared template validation");
if (!apply) {
  console.log(
    JSON.stringify({
      validated: true,
      resourcesCreated: 0,
      applyRequested: false,
    }),
  );
  process.exit(0);
}
const describe = async (id = state.stackName) => {
  try {
    return (
      await aws(["cloudformation", "describe-stacks", "--stack-name", id])
    ).Stacks[0];
  } catch (error) {
    if (error.missing) return null;
    throw error;
  }
};
const until = async (operation, seconds, label) => {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const result = await operation();
    if (result) return result;
    await pause(5000);
  }
  throw new Error(`Bounded relay ${label} timed out`);
};
const settled = async (id) =>
  until(
    async () => {
      const stack = await describe(id);
      return !stack || !stack.StackStatus.endsWith("IN_PROGRESS")
        ? stack || { StackStatus: "DELETE_COMPLETE" }
        : null;
    },
    300,
    "stack-settlement",
  );
const shell = async (command) => {
  const result = await aws([
    "ssm",
    "send-command",
    "--document-name",
    "AWS-RunShellScript",
    "--instance-ids",
    outputs.RelayId,
    "--timeout-seconds",
    "30",
    "--parameters",
    JSON.stringify({ commands: [command], executionTimeout: ["30"] }),
  ]);
  const invocation = await until(
    async () => {
      try {
        const status = await aws([
          "ssm",
          "get-command-invocation",
          "--command-id",
          result.Command.CommandId,
          "--instance-id",
          outputs.RelayId,
        ]);
        if (["Pending", "InProgress", "Delayed"].includes(status.Status))
          return null;
        if (status.Status !== "Success")
          throw new Error("Bounded relay administration failed");
        return status;
      } catch (error) {
        if (error.missing) return null;
        throw error;
      }
    },
    60,
    "administration",
  );
  try {
    return JSON.parse(invocation.StandardOutputContent);
  } catch {
    throw new Error("Relay returned invalid metadata");
  }
};
const report = {
  scope:
    "M0 two synthetic browser endpoints on one Mac through a disposable remote relay; not different-client-network, app pairing/sync, native or iPhone acceptance",
  startedAt: new Date().toISOString(),
  region: plan.region,
  estimatedAllowanceUSD: plan.estimatedUSD,
  allowanceUSD: 2,
  appDatabasesOpened: 0,
  payloadsPersistedByServer: 0,
  cleanupVerified: false,
};
try {
  const port = {
    async checkpoint(stage) {
      state = { ...state, stage, observedAt: new Date().toISOString() };
      if (stage === "cleanup-verified") {
        state.cleanupVerified = true;
        report.cleanupVerified = true;
      }
      await privateWrite("state.json", state);
      console.log(JSON.stringify({ stage }));
    },
    async create() {
      const parameters = [
        { ParameterKey: "RunId", ParameterValue: plan.runId },
        { ParameterKey: "ClientCidr", ParameterValue: plan.clientCidr },
        { ParameterKey: "ImageId", ParameterValue: plan.imageId },
        {
          ParameterKey: "TerminateAt",
          ParameterValue: `at(${plan.terminateAt.slice(0, 19)})`,
        },
      ];
      await privateWrite("parameters.json", parameters);
      let result;
      try {
        result = await aws([
          "cloudformation",
          "create-stack",
          "--stack-name",
          state.stackName,
          "--template-body",
          `file://${join(folder, "template.json")}`,
          "--parameters",
          `file://${join(folder, "parameters.json")}`,
          "--capabilities",
          "CAPABILITY_IAM",
          "--on-failure",
          "DELETE",
          "--client-request-token",
          plan.runId,
          "--tags",
          "Key=PeelEnvironment,Value=isolated-m0",
          `Key=PeelRun,Value=${plan.runId}`,
        ]);
      } catch (error) {
        createRejected = !!error.awsCode;
        throw error;
      }
      createConfirmed = true;
      stackId = result.StackId;
      state.resourcesCreated = true;
      state.stackId = stackId;
    },
    async waitReady() {
      const stack = await settled(stackId);
      if (stack.StackStatus !== "CREATE_COMPLETE")
        throw new Error("Disposable stack did not become ready");
      outputs = Object.fromEntries(
        stack.Outputs.map((value) => [value.OutputKey, value.OutputValue]),
      );
      await privateWrite("outputs.json", outputs);
      const instance = (
        await aws([
          "ec2",
          "describe-instances",
          "--instance-ids",
          outputs.RelayId,
        ])
      ).Reservations[0].Instances[0];
      if (
        instance.InstanceType !== "t4g.micro" ||
        instance.MetadataOptions.HttpTokens !== "required" ||
        instance.PublicIpAddress !== outputs.PublicIp
      )
        throw new Error("Actual relay differs from expected instance");
      const schedule = await aws([
        "scheduler",
        "get-schedule",
        "--name",
        "terminate",
        "--group-name",
        outputs.ExpiryGroupName,
      ]);
      if (
        schedule.State !== "ENABLED" ||
        schedule.ScheduleExpression !==
          `at(${plan.terminateAt.slice(0, 19)})` ||
        schedule.Target.RoleArn !== outputs.ExpiryRoleArn ||
        JSON.parse(schedule.Target.Input).InstanceIds[0] !== outputs.RelayId
      )
        throw new Error("Independent expiry is not active for this relay");
      report.independentExpiryConfigured = true;
      await until(
        async () => {
          const instances = await aws([
            "ssm",
            "describe-instance-information",
            "--filters",
            JSON.stringify([{ Key: "InstanceIds", Values: [outputs.RelayId] }]),
          ]);
          return instances.InstanceInformationList.some(
            (value) => value.PingStatus === "Online",
          );
        },
        360,
        "agent-readiness",
      );
      health = await until(
        async () => {
          try {
            const result = await shell(
              "python3 /usr/local/lib/peel-m0-turn/health.py",
            );
            return result.serviceActive ? result : null;
          } catch {
            return null;
          }
        },
        360,
        "runtime-readiness",
      );
      const required = [
        "serviceActive",
        "guestTimerActive",
        "coreDumpDisabled",
        "runtimeInMemory",
        "authenticationConfigured",
        "limitsConfigured",
        "logsDisabled",
        "peerRestricted",
      ];
      if (
        required.some((key) => health[key] !== true) ||
        health.swapEntries !== 0
      )
        throw new Error("Runtime cost/privacy guard did not pass");
      report.runtime = health;
    },
    async experiment() {
      const good = parseLease(
        await shell("python3 /usr/local/lib/peel-m0-turn/lease.py"),
        outputs.PublicIp,
        Math.floor(Date.now() / 1000),
      );
      const expired = await shell(
        "python3 /usr/local/lib/peel-m0-turn/lease.py --expired-fixture",
      );
      parseLease(expired, outputs.PublicIp, expired.expiresAt - 1);
      if (expired.expiresAt >= Date.now() / 1000)
        throw new Error("Expired lease fixture is not expired");
      await privateWrite("lease.json", good);
      await build({
        configFile: false,
        logLevel: "warn",
        build: {
          ssr: "tests/fixtures/relay-channel.ts",
          outDir: join(folder, "fixture"),
          emptyOutDir: true,
        },
      });
      const module = await readFile(join(folder, "fixture/relay-channel.js"));
      const server = createServer((req, res) => {
        res.writeHead(200, {
          "Content-Type":
            req.url === "/fixture.js" ? "text/javascript" : "text/html",
          "Cache-Control": "no-store",
        });
        res.end(
          req.url === "/fixture.js"
            ? module
            : "<!doctype html><title>Peel isolated relay</title>",
        );
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      let browser;
      try {
        browser = await chromium.launch({
          executablePath:
            process.env.PEEL_BROWSER_PATH ||
            (process.platform === "darwin"
              ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
              : undefined),
        });
        const page = await browser.newPage();
        let pageErrors = 0;
        page.on("pageerror", () => pageErrors++);
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const result = await page.evaluate(
          async ({ good, expired }) => {
            const mod = await import("/fixture.js");
            const partial = {};
            let stage = "udp";
            try {
              partial.udp = await mod.relayTransfer(good, "udp");
              stage = "invalid-credential";
              const invalid = await mod.rejectedLease({
                ...good,
                credential: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=",
              });
              stage = "expired-credential";
              const old = await mod.rejectedLease(expired);
              stage = "tcp";
              partial.tcp = await mod.relayTransfer(good, "tcp");
              return {
                ...partial,
                passed: true,
                invalidCredentialNoCandidate:
                  invalid.noCandidateWithinBound && invalid.noHostFallback,
                expiredCredentialNoCandidate:
                  old.noCandidateWithinBound && old.noHostFallback,
              };
            } catch (error) {
              return {
                ...partial,
                passed: false,
                failureStage: stage,
                diagnostic: error.diagnostic ?? null,
              };
            }
          },
          { good, expired },
        );
        report.channel = result;
        if (
          !result.passed ||
          pageErrors ||
          !result.invalidCredentialNoCandidate ||
          !result.expiredCredentialNoCandidate
        )
          throw new Error("Relay negative-control validation failed");
        report.browser = browser.version();
        report.pageErrors = pageErrors;
        return result;
      } finally {
        await browser?.close();
        await new Promise((resolve) => server.close(resolve));
      }
    },
    async inspectOwnedName() {
      // A missing initial response does not prove the create did not reach AWS. Allow discovery time.
      let stack = await describe(stackId || state.stackName);
      if (!stack && !createConfirmed)
        for (let i = 0; i < 4 && !stack; i++) {
          await pause(5000);
          stack = await describe(state.stackName);
        }
      if (!stack && !createConfirmed && !createRejected)
        throw new Error(
          "Create outcome remains unconfirmed; cleanup cannot be claimed",
        );
      if (!stack) return null;
      const tags = Object.fromEntries(
        (stack.Tags || []).map((tag) => [tag.Key, tag.Value]),
      );
      return {
        stackId: stack.StackId,
        stackName: stack.StackName,
        accountId: stack.StackId.split(":")[4],
        region: stack.StackId.split(":")[3],
        environment: tags.PeelEnvironment,
        runId: tags.PeelRun,
      };
    },
    async delete(id) {
      const current = await settled(id);
      if (current.StackStatus === "DELETE_COMPLETE") return;
      await aws(["cloudformation", "delete-stack", "--stack-name", id]);
    },
    async waitDeleted(id) {
      await until(
        async () => {
          const stack = await describe(id);
          return !stack || stack.StackStatus === "DELETE_COMPLETE";
        },
        300,
        "stack-deletion",
      );
      await until(
        async () => {
          const live = await aws([
            "ec2",
            "describe-instances",
            "--filters",
            JSON.stringify([
              { Name: "tag:PeelRun", Values: [plan.runId] },
              { Name: "tag:PeelEnvironment", Values: ["isolated-m0"] },
              {
                Name: "instance-state-name",
                Values: [
                  "pending",
                  "running",
                  "stopping",
                  "stopped",
                  "shutting-down",
                ],
              },
            ]),
          ]);
          return live.Reservations.every(
            (reservation) => reservation.Instances.length === 0,
          );
        },
        60,
        "instance-termination",
      );
    },
  };
  for (const name of [
    "create",
    "waitReady",
    "experiment",
    "delete",
    "waitDeleted",
    "inspectOwnedName",
  ]) {
    const operation = port[name];
    port[name] = async (...args) => {
      try {
        return await operation(...args);
      } catch (error) {
        if (["delete", "waitDeleted", "inspectOwnedName"].includes(name))
          report.cleanupFailureOperation = lastOperation;
        else {
          report.failureStage ??= name;
          report.failureOperation ??= lastOperation;
        }
        throw error;
      }
    };
  }
  const result = await runDisposable(plan, port);
  report.checks = result;
  report.passed = true;
} catch {
  report.passed = false;
  report.failureOperation ??= lastOperation;
  report.failureStage ??= state.stage;
  process.exitCode = 1;
} finally {
  await rm(join(folder, "lease.json"), { force: true });
  report.finishedAt = new Date().toISOString();
  await privateWrite("result.json", report);
  console.log(JSON.stringify(report, null, 2));
}
