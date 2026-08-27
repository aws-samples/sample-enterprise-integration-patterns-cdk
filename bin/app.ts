#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

const app = new cdk.App();

// Example: Import and use any pattern construct in a stack
// import { PublishSubscribeSns } from '../lib';
//
// class MyIntegrationStack extends cdk.Stack {
//   constructor(scope: cdk.App, id: string) {
//     super(scope, id);
//     new PublishSubscribeSns(this, 'PubSub', { subscriberQueues: 3 });
//   }
// }
// new MyIntegrationStack(app, 'MyIntegrationStack');

app.synth();
