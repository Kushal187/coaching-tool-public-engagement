#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CoachingToolStack } from '../lib/coaching-tool-stack';

const app = new cdk.App();

// Global tags applied to every resource in the app
cdk.Tags.of(app).add('Environment', 'non-prod');
cdk.Tags.of(app).add('Project', 'coaching-tool');

new CoachingToolStack(app, 'CoachingToolStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: 'Coaching Tool - Full stack infrastructure for public engagement coaching application',
});

app.synth();
