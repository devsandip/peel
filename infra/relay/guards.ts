import { isIP } from "node:net";
import { relayTemplate } from "./template.ts";

export interface RunPlan {
  profile: string;
  region: string;
  accountId: string;
  runId: string;
  clientCidr: string;
  imageId: string;
  createdAt: string;
  terminateAt: string;
  allowanceUSD: number;
  estimatedUSD: number;
}
const fail = (message: string): never => {
  throw new Error(message);
};
export function validateRun(
  plan: RunPlan,
  actual: { accountId: string; clientIp: string; now: number },
) {
  if (plan.profile !== "admin" || plan.region !== "us-east-1")
    fail("Unexpected AWS profile or region");
  if (!/^\d{12}$/.test(plan.accountId) || plan.accountId !== actual.accountId)
    fail("AWS account changed");
  if (!/^[a-z][a-z0-9-]{5,35}$/.test(plan.runId))
    fail("Invalid isolated run identity");
  if (
    isIP(actual.clientIp) !== 4 ||
    plan.clientCidr !== `${actual.clientIp}/32`
  )
    fail("Client address changed or ingress is broader than one address");
  if (!/^ami-[0-9a-f]{17}$/.test(plan.imageId))
    fail("Invalid verified image identity");
  const age = actual.now - Date.parse(plan.createdAt);
  const lifetime = Date.parse(plan.terminateAt) - actual.now;
  if (!Number.isFinite(age) || age < -60000 || age > 15 * 60000)
    fail("Stale or future deployment plan");
  if (
    !Number.isFinite(lifetime) ||
    lifetime < 5 * 60000 ||
    lifetime > 60 * 60000
  )
    fail("Invalid termination deadline");
  if (
    plan.allowanceUSD !== 2 ||
    !Number.isFinite(plan.estimatedUSD) ||
    plan.estimatedUSD <= 0 ||
    plan.estimatedUSD > plan.allowanceUSD
  )
    fail("Experiment cost exceeds its bounded allowance");
}
export function validateRelayTemplate(
  template: ReturnType<typeof relayTemplate>,
) {
  const resources = template.Resources;
  const expected = relayTemplate("synthetic-bootstrap").Resources;
  // A disposable stack must not grow new services or target unrelated resources silently.
  if (
    Object.keys(resources).sort().join() !== Object.keys(expected).sort().join()
  )
    fail("Unexpected stack resource inventory");
  for (const [key, resource] of Object.entries(resources)) {
    if (resource.Type !== expected[key as keyof typeof expected].Type)
      fail("Unexpected stack resource type");
    if ("DeletionPolicy" in resource || "UpdateReplacePolicy" in resource)
      fail("Resource retention is not allowed");
  }
  const relay = resources.Relay.Properties;
  if (
    relay.InstanceType !== "t4g.micro" ||
    relay.CreditSpecification.CPUCredits !== "standard" ||
    relay.InstanceInitiatedShutdownBehavior !== "terminate"
  )
    fail("Unsafe compute or shutdown configuration");
  const disk = relay.BlockDeviceMappings;
  if (
    disk.length !== 1 ||
    disk[0].Ebs.VolumeSize !== 8 ||
    disk[0].Ebs.VolumeType !== "gp3" ||
    !disk[0].Ebs.Encrypted ||
    !disk[0].Ebs.DeleteOnTermination
  )
    fail("Unsafe persistent volume configuration");
  if (
    relay.MetadataOptions.HttpTokens !== "required" ||
    relay.MetadataOptions.HttpPutResponseHopLimit !== 1
  )
    fail("IMDSv2 is required");
  const ingress = resources.Firewall.Properties.SecurityGroupIngress;
  if (
    ingress.length !== 2 ||
    ingress.some(
      (rule) =>
        rule.FromPort !== 3478 ||
        rule.ToPort !== 3478 ||
        !["tcp", "udp"].includes(rule.IpProtocol) ||
        rule.CidrIp.Ref !== "ClientCidr",
    )
  )
    fail("Unsafe client ingress");
  for (const rule of [
    resources.RelaySelfIngress.Properties,
    resources.RelaySelfEgress.Properties,
  ]) {
    if (
      rule.CidrIp["Fn::Sub"] !== "${Relay.PublicIp}/32" ||
      rule.IpProtocol !== "udp" ||
      rule.FromPort !== 49160 ||
      rule.ToPort !== 49179 ||
      rule.GroupId.Ref !== "Firewall"
    )
      fail("Unsafe relay self-traffic");
  }
  if (
    resources.Expiry.Properties.State !== "ENABLED" ||
    resources.Expiry.Properties.FlexibleTimeWindow.Mode !== "OFF" ||
    resources.Expiry.Properties.ScheduleExpression.Ref !== "TerminateAt"
  )
    fail("Independent termination schedule is required");
  const target = resources.Expiry.Properties.Target;
  if (
    target.Arn["Fn::Sub"] !==
      "arn:${AWS::Partition}:scheduler:::aws-sdk:ec2:terminateInstances" ||
    target.Input["Fn::Sub"] !== '{"InstanceIds":["${Relay}"]}'
  )
    fail("Termination target changed");
  const policy =
    resources.ExpiryRole.Properties.Policies[0].PolicyDocument.Statement;
  if (
    policy.length !== 1 ||
    policy[0].Action !== "ec2:TerminateInstances" ||
    policy[0].Resource["Fn::Sub"] !==
      "arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:instance/${Relay}"
  )
    fail("Termination permission is broader than this instance");
  const trust =
    resources.ExpiryRole.Properties.AssumeRolePolicyDocument.Statement[0]
      .Condition.StringEquals;
  if (
    trust["aws:SourceAccount"].Ref !== "AWS::AccountId" ||
    trust["aws:SourceArn"]["Fn::GetAtt"].join() !== "ExpiryGroup,Arn"
  )
    fail("Scheduler trust must use this account and schedule group");
  if (
    !relay.UserData["Fn::Base64"].includes("__LEASE_HELPER__") &&
    !relay.UserData["Fn::Base64"].includes("def issue(")
  )
    fail("Missing authentication helper");
  for (const required of [
    "--on-active=30m",
    "shutdown -h now",
    "use-auth-secret",
    "total-quota=4",
    "bps-capacity=131072",
    "log-file=/dev/null",
    "no-stdout-log",
    "LimitCORE=0",
    "MemoryMax=192M",
    "ReadWritePaths=/run/peel-m0-turn/runtime",
  ]) {
    if (!relay.UserData["Fn::Base64"].includes(required))
      fail("Missing runtime cost/privacy guard");
  }
}
export function parseLease(
  value: unknown,
  publicIp: string,
  nowSeconds: number,
) {
  const lease = value as {
    expiresAt: number;
    username: string;
    credential: string;
    urls: string[];
  };
  if (
    !lease ||
    typeof lease !== "object" ||
    Object.keys(lease).sort().join() !== "credential,expiresAt,urls,username"
  )
    fail("Invalid TURN lease fields");
  if (
    !Number.isSafeInteger(lease.expiresAt) ||
    lease.expiresAt <= nowSeconds ||
    lease.expiresAt > nowSeconds + 300
  )
    fail("TURN lease expired or too long");
  if (
    typeof lease.username !== "string" ||
    !new RegExp(`^${lease.expiresAt}:peel-m0:[a-z0-9-]{8,64}$`).test(
      lease.username,
    )
  )
    fail("TURN lease identity mismatch");
  if (
    typeof lease.credential !== "string" ||
    !/^[A-Za-z0-9+/]{27}=$/.test(lease.credential)
  )
    fail("Invalid TURN credential encoding");
  const urls = ["udp", "tcp"].map(
    (transport) => `turn:${publicIp}:3478?transport=${transport}`,
  );
  if (
    !Array.isArray(lease.urls) ||
    JSON.stringify(lease.urls) !== JSON.stringify(urls) ||
    isIP(publicIp) !== 4
  )
    fail("TURN lease targets another relay");
  return { ...lease, urls: [...urls] };
}
