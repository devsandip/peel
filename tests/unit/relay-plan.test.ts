import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { relayTemplate } from "../../infra/relay/template";
import { renderBootstrap } from "../../infra/relay/bootstrap";
import {
  validateRun,
  validateRelayTemplate,
  parseLease,
  type RunPlan,
} from "../../infra/relay/guards";

const now = Date.parse("2026-10-27T00:00:00Z");
const actual = { now, accountId: "111122223333", clientIp: "8.8.8.8" };
const plan = (): RunPlan => ({
  profile: "admin",
  region: "us-east-1",
  accountId: actual.accountId,
  runId: "synthetic-relay",
  clientCidr: `${actual.clientIp}/32`,
  imageId: "ami-0123456789abcdef0",
  createdAt: new Date(now).toISOString(),
  terminateAt: new Date(now + 45 * 60000).toISOString(),
  allowanceUSD: 2,
  estimatedUSD: 0.1,
});
const bootstrap = renderBootstrap(
  readFileSync("infra/relay/bootstrap.sh", "utf8"),
  readFileSync("infra/relay/lease.py", "utf8"),
  readFileSync("infra/relay/health.py", "utf8"),
);

describe("isolated relay preflight, AC-10/21/25 prerequisite only", () => {
  it("rejects account/address drift, broad ingress, stale/overlong plans and unbounded costs before writes", () => {
    expect(() => validateRun(plan(), actual)).not.toThrow();
    for (const mutation of [
      { accountId: "444455556666" },
      { region: "eu-west-1" },
      { profile: "default" },
      { clientCidr: "0.0.0.0/0" },
      { clientCidr: "8.8.4.4/32" },
      { runId: "../other-stack" },
      { terminateAt: new Date(now + 2 * 3600000).toISOString() },
      { terminateAt: new Date(now - 1).toISOString() },
      { createdAt: new Date(now - 3600000).toISOString() },
      { allowanceUSD: 100 },
      { estimatedUSD: 3 },
      { estimatedUSD: Number.NaN },
    ])
      expect(() => validateRun({ ...plan(), ...mutation }, actual)).toThrow();
  });
  it("rejects mutations that increase resources, broaden traffic or remove independent termination", () => {
    expect(() => validateRelayTemplate(relayTemplate(bootstrap))).not.toThrow();
    const mutations = [
      (t: ReturnType<typeof relayTemplate>) => {
        t.Resources.Relay.Properties.InstanceType = "m7g.16xlarge";
      },
      (t: ReturnType<typeof relayTemplate>) => {
        t.Resources.Relay.Properties.CreditSpecification.CPUCredits =
          "unlimited";
      },
      (t: ReturnType<typeof relayTemplate>) => {
        t.Resources.Relay.Properties.BlockDeviceMappings[0].Ebs.DeleteOnTermination = false;
      },
      (t: ReturnType<typeof relayTemplate>) => {
        t.Resources.Relay.Properties.BlockDeviceMappings[0].Ebs.Encrypted = false;
      },
      (t: ReturnType<typeof relayTemplate>) => {
        t.Resources.Expiry.Properties.State = "DISABLED";
      },
      (t: ReturnType<typeof relayTemplate>) => {
        t.Resources.Firewall.Properties.SecurityGroupIngress[0].CidrIp.Ref =
          "AWS::NoValue";
      },
      (t: ReturnType<typeof relayTemplate>) => {
        t.Resources.ExpiryRole.Properties.Policies[0].PolicyDocument.Statement[0].Action =
          "ec2:*";
      },
      (t: ReturnType<typeof relayTemplate>) => {
        t.Resources.ExpiryRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[
          "aws:SourceArn"
        ]["Fn::GetAtt"] = ["Expiry", "Arn"];
      },
      (t: ReturnType<typeof relayTemplate>) => {
        t.Resources.Relay.Properties.UserData["Fn::Base64"] =
          "#!/bin/bash\ntrue";
      },
      (t: ReturnType<typeof relayTemplate>) => {
        Reflect.set(t.Resources, "UnexpectedBucket", {
          Type: "AWS::S3::Bucket",
        });
      },
    ];
    for (const mutate of mutations) {
      const template = relayTemplate(bootstrap);
      mutate(template);
      expect(() => validateRelayTemplate(template)).toThrow();
    }
  });
  it("matches Python TURN REST HMAC leases and rejects expiry, substitution and extra credentials", () => {
    const code = `import importlib.util,json\ns=importlib.util.spec_from_file_location('fixture','infra/relay/lease.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(json.dumps(m.issue(b'synthetic-shared-secret-for-test-only',1000,'synthetic-nonce','8.8.8.8')))\n`;
    const lease = JSON.parse(
      execFileSync("python3", ["-c", code], { encoding: "utf8" }),
    );
    expect(lease.credential).toBe(
      createHmac("sha1", "synthetic-shared-secret-for-test-only")
        .update("1300:peel-m0:synthetic-nonce")
        .digest("base64"),
    );
    expect(parseLease(lease, "8.8.8.8", 1000).expiresAt).toBe(1300);
    for (const mutated of [
      { ...lease, expiresAt: 999 },
      { ...lease, expiresAt: 1400 },
      { ...lease, username: "1301:peel-m0:synthetic-nonce" },
      { ...lease, urls: ["turn:1.1.1.1:3478?transport=udp"] },
      { ...lease, masterSecret: "synthetic-never-accepted" },
    ])
      expect(() => parseLease(mutated, "8.8.8.8", 1000)).toThrow();
    expect(() => parseLease(lease, "8.8.8.8", 1300)).toThrow();
  });
});
