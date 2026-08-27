import { Construct } from 'constructs';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  BasePatternProps,
  DEFAULT_LAMBDA_RUNTIME,
  DEFAULT_LAMBDA_TIMEOUT,
  DEFAULT_LOG_RETENTION,
} from '../types';

export interface AppSyncResolver {
  typeName: string;
  fieldName: string;
  kind: 'lambda' | 'dynamodb';
  lambdaConfig?: { handler: string; code: lambda.Code; runtime?: lambda.Runtime };
}

export interface PipelineResolverConfig {
  typeName: string;
  fieldName: string;
  /** Ordered list of data source indices (from resolvers array) to call in sequence */
  steps: number[];
}

export interface ApiCompositionAppSyncProps extends BasePatternProps {
  apiName?: string;
  schemaPath: string;
  resolvers: AppSyncResolver[];
  pipelineResolvers?: PipelineResolverConfig[];
  /** Default authentication. IAM by default — opt into API_KEY/COGNITO/OIDC explicitly. */
  authorizationConfig?: appsync.AuthorizationConfig;
}

/**
 * API Composition via AppSync (EIP Sync Aggregator)
 */
export class ApiCompositionAppSync extends Construct {
  public readonly api: appsync.GraphqlApi;
  public readonly tables: dynamodb.Table[] = [];
  public readonly lambdaFunctions: lambda.Function[] = [];
  public readonly dataSources: appsync.BaseDataSource[] = [];

  constructor(scope: Construct, id: string, props: ApiCompositionAppSyncProps) {
    super(scope, id);
    const removal = props.removalPolicy ?? RemovalPolicy.DESTROY;
    const timeout = props.lambdaTimeout ?? DEFAULT_LAMBDA_TIMEOUT;
    const logRetention = props.logRetention ?? DEFAULT_LOG_RETENTION;

    this.api = new appsync.GraphqlApi(this, 'Api', {
      name: props.apiName ?? `${id}-api`,
      definition: appsync.Definition.fromFile(props.schemaPath),
      authorizationConfig: props.authorizationConfig ?? {
        defaultAuthorization: { authorizationType: appsync.AuthorizationType.IAM },
      },
      xrayEnabled: true,
    });

    for (const [i, resolver] of props.resolvers.entries()) {
      if (resolver.kind === 'lambda' && resolver.lambdaConfig) {
        const fn = new lambda.Function(this, `Fn${i}`, {
          runtime: resolver.lambdaConfig.runtime ?? DEFAULT_LAMBDA_RUNTIME,
          handler: resolver.lambdaConfig.handler,
          code: resolver.lambdaConfig.code,
          timeout,
          logRetention,
        });
        this.lambdaFunctions.push(fn);
        const ds = this.api.addLambdaDataSource(`LambdaDS${i}`, fn);
        this.dataSources.push(ds);
        ds.createResolver(`Resolver${i}`, { typeName: resolver.typeName, fieldName: resolver.fieldName });
      } else if (resolver.kind === 'dynamodb') {
        const table = new dynamodb.Table(this, `Table${i}`, {
          partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
          billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
          pointInTimeRecovery: true,
          removalPolicy: removal,
        });
        this.tables.push(table);
        const ds = this.api.addDynamoDbDataSource(`DdbDS${i}`, table);
        this.dataSources.push(ds);
        ds.createResolver(`Resolver${i}`, {
          typeName: resolver.typeName,
          fieldName: resolver.fieldName,
          requestMappingTemplate: appsync.MappingTemplate.dynamoDbGetItem('id', 'id'),
          responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
        });
      }
    }

    for (const [i, pipeline] of (props.pipelineResolvers ?? []).entries()) {
      const functions = pipeline.steps.map((dsIndex, stepIdx) => {
        const ds = this.dataSources[dsIndex];
        return new appsync.AppsyncFunction(this, `PipelineFn${i}Step${stepIdx}`, {
          name: `pipeline${i}_step${stepIdx}`,
          api: this.api,
          dataSource: ds,
          // VTL has no `??` operator. Use #if/#else to fall back to args on the first step.
          requestMappingTemplate: appsync.MappingTemplate.fromString(
            '#if($ctx.prev.result)\n$util.toJson($ctx.prev.result)\n#else\n$util.toJson($ctx.args)\n#end',
          ),
          responseMappingTemplate: appsync.MappingTemplate.fromString('$util.toJson($ctx.result)'),
        });
      });

      new appsync.Resolver(this, `PipelineResolver${i}`, {
        api: this.api,
        typeName: pipeline.typeName,
        fieldName: pipeline.fieldName,
        pipelineConfig: functions,
        requestMappingTemplate: appsync.MappingTemplate.fromString('$util.toJson($ctx.args)'),
        responseMappingTemplate: appsync.MappingTemplate.fromString('$util.toJson($ctx.prev.result)'),
      });
    }
  }
}
