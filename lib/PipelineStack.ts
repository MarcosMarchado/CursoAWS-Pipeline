import { CfnCapabilities, RemovalPolicy, SecretValue, Stack, StackProps } from 'aws-cdk-lib';
import { BuildSpec, LinuxBuildImage, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { CloudFormationCreateReplaceChangeSetAction, CloudFormationExecuteChangeSetAction, CodeBuildAction, GitHubSourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { Effect, ManagedPolicy, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as Yaml from "yaml"

export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const artifactsBucket = new Bucket(this, "S3BucketForPipelineArtifacts", {
      removalPolicy: RemovalPolicy.DESTROY
    });

    const pipeline = new Pipeline(this, "Pipeline", {
      pipelineName: "Pipeline",
      crossAccountKeys: false
    })

    const sourceOutput = new Artifact("SourceOutput")

    pipeline.addStage({
      stageName: "Source",
      actions: [
        new GitHubSourceAction({
          owner: "MarcosMarchado",
          repo: "lambda-quarkus",
          branch: "main",
          actionName: "Source",
          oauthToken: SecretValue.secretsManager("github-token"),
          output: sourceOutput
        })
      ]
    })

    const buildArtifact = new Artifact("BuildArtifact")

    const pipelineProject = new PipelineProject(this, "CodeBuildProject", {
      environment: {
        buildImage: LinuxBuildImage.STANDARD_5_0,
        privileged: true
      },
      buildSpec: BuildSpec.fromObjectToYaml(this.getBuildSpecYml(artifactsBucket.bucketName))
    })

    pipelineProject.role?.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"))
    //artifactsBucket.grantReadWrite(pipeline.role) Tentar com essa alternativa

    pipeline.addStage({
      stageName: "Build",
      actions: [new CodeBuildAction({
        actionName: "BuildAction",
        input: sourceOutput,
        outputs: [buildArtifact],
        project: pipelineProject
      })]
    })

    //Deploy Stage
    const stackName = 'Codepipeline-Lambda-Stack';
    const changeSetName = 'StagedChangeSet'

    const createReplaceChangeSetAction = new CloudFormationCreateReplaceChangeSetAction({
      actionName: "PrepareChanges",
      stackName: stackName,
      changeSetName: changeSetName,
      templatePath: buildArtifact.atPath('outputtemplate.yml'),
      cfnCapabilities: [
        CfnCapabilities.NAMED_IAM,
        CfnCapabilities.AUTO_EXPAND
      ],
      adminPermissions: false,
      runOrder: 1
    });

    const executeChangeSetAction = new CloudFormationExecuteChangeSetAction({
      actionName: "ExecuteChanges",
      changeSetName: changeSetName,
      stackName: stackName,
      runOrder: 2
    })

    pipeline.addStage({
      stageName: "Deploy",
      actions: [
        createReplaceChangeSetAction,
        executeChangeSetAction
      ],
    });

    //Permission for CloudFormation to access Lambda and other resources
    createReplaceChangeSetAction.deploymentRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AWSLambdaExecute'));
    createReplaceChangeSetAction.deploymentRole.attachInlinePolicy(this.getCodePipelineCloudFormationInlinePolicy());
  }
  //https://docs.aws.amazon.com/pt_br/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-package.html
  //https://stackoverflow.com/questions/71406505/how-to-writing-the-buildspec-yaml-code-in-cdk
  getBuildSpecYml(bucket: string) {
    return Yaml.parse(`
    version: 0.2

    phases:
      install:
        runtime-versions:
          java: corretto11
        commands:
          - mvn install
      pre_build:
        commands:
          - echo Dependencias instaladas...
      build:
        commands:
          - mvn clean package
          - export BUCKET=${bucket}
          - sam package --s3-bucket $BUCKET --template target/sam.jvm.yaml --output-template-file outputtemplate.yml
    
    artifacts:
      types: zip
      files:
        - outputtemplate.yml
        - target/sam.jvm.yaml`)
  }

  //Inline permission policy for CloudFormation
  private getCodePipelineCloudFormationInlinePolicy = () => {
    return new Policy(this, 'CodePipelineCloudFormationInlinePolicy', {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "apigateway:*",
            "codedeploy:*",
            "lambda:*",
            "cloudformation:CreateChangeSet",
            "iam:GetRole",
            "iam:CreateRole",
            "iam:DeleteRole",
            "iam:PutRolePolicy",
            "iam:AttachRolePolicy",
            "iam:DeleteRolePolicy",
            "iam:DetachRolePolicy",
            "iam:PassRole",
            "s3:GetObject",
            "s3:GetObjectVersion",
            "s3:GetBucketVersioning"
          ],
          resources: ['*']
        })
      ]
    })
  }
}
