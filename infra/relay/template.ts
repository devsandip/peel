// Disposable M0 infrastructure only. No app notes, entitlement, bucket or database.
const ref = (name: string) => ({ Ref: name });
const attr = (name: string, key: string) => ({ "Fn::GetAtt": [name, key] });
const sub = (value: string) => ({ "Fn::Sub": value });
const tags = () => [
  { Key: "PeelEnvironment", Value: "isolated-m0" },
  { Key: "PeelRun", Value: ref("RunId") },
];
export function relayTemplate(bootstrap: string) {
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "Peel disposable authenticated TURN experiment; synthetic bytes only",
    Parameters: {
      RunId: { Type: "String", AllowedPattern: "^[a-z][a-z0-9-]{5,35}$" },
      ClientCidr: {
        Type: "String",
        AllowedPattern: "^([0-9]{1,3}\\.){3}[0-9]{1,3}/32$",
      },
      ImageId: { Type: "AWS::EC2::Image::Id" },
      TerminateAt: { Type: "String", AllowedPattern: "^at\\([0-9T:-]+\\)$" },
    },
    Resources: {
      Network: {
        Type: "AWS::EC2::VPC",
        Properties: {
          CidrBlock: "10.82.0.0/24",
          EnableDnsSupport: true,
          EnableDnsHostnames: true,
          Tags: tags(),
        },
      },
      Gateway: {
        Type: "AWS::EC2::InternetGateway",
        Properties: { Tags: tags() },
      },
      Attachment: {
        Type: "AWS::EC2::VPCGatewayAttachment",
        Properties: {
          VpcId: ref("Network"),
          InternetGatewayId: ref("Gateway"),
        },
      },
      Subnet: {
        Type: "AWS::EC2::Subnet",
        Properties: {
          VpcId: ref("Network"),
          CidrBlock: "10.82.0.0/28",
          MapPublicIpOnLaunch: true,
          Tags: tags(),
        },
      },
      Routes: {
        Type: "AWS::EC2::RouteTable",
        Properties: { VpcId: ref("Network"), Tags: tags() },
      },
      DefaultRoute: {
        Type: "AWS::EC2::Route",
        DependsOn: "Attachment",
        Properties: {
          RouteTableId: ref("Routes"),
          DestinationCidrBlock: "0.0.0.0/0",
          GatewayId: ref("Gateway"),
        },
      },
      SubnetRoute: {
        Type: "AWS::EC2::SubnetRouteTableAssociation",
        Properties: { RouteTableId: ref("Routes"), SubnetId: ref("Subnet") },
      },
      Firewall: {
        Type: "AWS::EC2::SecurityGroup",
        Properties: {
          VpcId: ref("Network"),
          GroupDescription: "One verified client and relay self-traffic only",
          SecurityGroupIngress: ["udp", "tcp"].map((protocol) => ({
            IpProtocol: protocol,
            FromPort: 3478,
            ToPort: 3478,
            CidrIp: ref("ClientCidr"),
          })),
          SecurityGroupEgress: [80, 443].map((port) => ({
            IpProtocol: "tcp",
            FromPort: port,
            ToPort: port,
            CidrIp: "0.0.0.0/0",
          })),
          Tags: tags(),
        },
      },
      RelayRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { Service: "ec2.amazonaws.com" },
                Action: "sts:AssumeRole",
              },
            ],
          },
          ManagedPolicyArns: [
            sub(
              "arn:${AWS::Partition}:iam::aws:policy/AmazonSSMManagedInstanceCore",
            ),
          ],
          Tags: tags(),
        },
      },
      RelayProfile: {
        Type: "AWS::IAM::InstanceProfile",
        Properties: { Roles: [ref("RelayRole")] },
      },
      Relay: {
        Type: "AWS::EC2::Instance",
        DependsOn: ["DefaultRoute", "SubnetRoute"],
        Properties: {
          ImageId: ref("ImageId"),
          InstanceType: "t4g.micro",
          CreditSpecification: { CPUCredits: "standard" },
          IamInstanceProfile: ref("RelayProfile"),
          InstanceInitiatedShutdownBehavior: "terminate",
          MetadataOptions: {
            HttpTokens: "required",
            HttpEndpoint: "enabled",
            HttpPutResponseHopLimit: 1,
          },
          NetworkInterfaces: [
            {
              DeviceIndex: "0",
              AssociatePublicIpAddress: true,
              SubnetId: ref("Subnet"),
              GroupSet: [ref("Firewall")],
            },
          ],
          BlockDeviceMappings: [
            {
              DeviceName: "/dev/sda1",
              Ebs: {
                VolumeSize: 8,
                VolumeType: "gp3",
                Encrypted: true,
                DeleteOnTermination: true,
              },
            },
          ],
          UserData: { "Fn::Base64": bootstrap },
          Tags: tags(),
        },
      },
      RelaySelfIngress: {
        Type: "AWS::EC2::SecurityGroupIngress",
        Properties: {
          GroupId: ref("Firewall"),
          IpProtocol: "udp",
          FromPort: 49160,
          ToPort: 49179,
          CidrIp: sub("${Relay.PublicIp}/32"),
        },
      },
      RelaySelfEgress: {
        Type: "AWS::EC2::SecurityGroupEgress",
        Properties: {
          GroupId: ref("Firewall"),
          IpProtocol: "udp",
          FromPort: 49160,
          ToPort: 49179,
          CidrIp: sub("${Relay.PublicIp}/32"),
        },
      },
      ExpiryGroup: {
        Type: "AWS::Scheduler::ScheduleGroup",
        Properties: { Name: sub("peel-m0-turn-${RunId}"), Tags: tags() },
      },
      ExpiryRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { Service: "scheduler.amazonaws.com" },
                Action: "sts:AssumeRole",
                Condition: {
                  StringEquals: {
                    "aws:SourceAccount": ref("AWS::AccountId"),
                    "aws:SourceArn": attr("ExpiryGroup", "Arn"),
                  },
                },
              },
            ],
          },
          Policies: [
            {
              PolicyName: "TerminateOnlyThisRelay",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [
                  {
                    Effect: "Allow",
                    Action: "ec2:TerminateInstances",
                    Resource: sub(
                      "arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:instance/${Relay}",
                    ),
                  },
                ],
              },
            },
          ],
          Tags: tags(),
        },
      },
      Expiry: {
        Type: "AWS::Scheduler::Schedule",
        Properties: {
          Name: "terminate",
          GroupName: ref("ExpiryGroup"),
          ScheduleExpression: ref("TerminateAt"),
          ScheduleExpressionTimezone: "UTC",
          FlexibleTimeWindow: { Mode: "OFF" },
          State: "ENABLED",
          Target: {
            Arn: sub(
              "arn:${AWS::Partition}:scheduler:::aws-sdk:ec2:terminateInstances",
            ),
            RoleArn: attr("ExpiryRole", "Arn"),
            Input: sub('{"InstanceIds":["${Relay}"]}'),
            RetryPolicy: {
              MaximumRetryAttempts: 2,
              MaximumEventAgeInSeconds: 300,
            },
          },
        },
      },
    },
    Outputs: {
      RelayId: { Value: ref("Relay") },
      PublicIp: { Value: attr("Relay", "PublicIp") },
      FirewallId: { Value: ref("Firewall") },
      ExpiryGroupName: { Value: ref("ExpiryGroup") },
      ExpiryRoleArn: { Value: attr("ExpiryRole", "Arn") },
    },
  };
}
