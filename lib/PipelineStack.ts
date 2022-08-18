import { SecretValue, Stack, StackProps } from 'aws-cdk-lib';
import { BuildSpec, LinuxBuildImage, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { Artifact, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, GitHubSourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { Construct } from 'constructs';
import * as Yaml from "yaml"

export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

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
          actionName: "Pipeline_Source",
          oauthToken: SecretValue.secretsManager("github-token"),
          output: sourceOutput
        })
      ]
    })

    const cdkBuildOutput = new Artifact("CdkBuildOutput")

    pipeline.addStage({
      stageName: "Build",
      actions: [new CodeBuildAction({
        actionName: "CDK_Build",
        input: sourceOutput,
        outputs: [cdkBuildOutput],
        project: new PipelineProject(this, "CdkBuildProject", {
          environment: {
            buildImage: LinuxBuildImage.STANDARD_5_0,
            privileged: true
          },
          buildSpec: BuildSpec.fromObjectToYaml(this.getBuildSpecYml())
        })
      })]
    })

  }
  //https://stackoverflow.com/questions/71406505/how-to-writing-the-buildspec-yaml-code-in-cdk
  getBuildSpecYml() {
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
    
    artifacts:
      files:
        - target/function.zip`)
  }
}
