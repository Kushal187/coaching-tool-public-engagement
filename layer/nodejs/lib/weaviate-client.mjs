// lib/weaviate-client.mjs
// ─────────────────────────────────────────────────────────────
// Shared Weaviate + OpenAI client initialisation.
//
// In Lambda: credentials loaded from Secrets Manager via the
// AWS Parameters and Secrets Lambda Extension (cached locally).
// Locally: credentials loaded from .env file via dotenv.
// ─────────────────────────────────────────────────────────────

import weaviate from 'weaviate-ts-client';
import { OpenAI } from 'openai';

// Load dotenv only when running outside Lambda (local dev)
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  await import('dotenv/config');
}

// ── Secrets Manager helper (Lambda only) ───────────────────

async function getSecret(secretId) {
  const token = process.env.AWS_SESSION_TOKEN;
  const resp = await fetch(
    `http://localhost:2773/secretsmanager/get?secretId=${encodeURIComponent(secretId)}`,
    { headers: { 'X-Aws-Parameters-Secrets-Token': token } },
  );
  if (!resp.ok) throw new Error(`Failed to get secret ${secretId}: ${resp.status}`);
  const data = await resp.json();
  return JSON.parse(data.SecretString);
}

// ── Load credentials ───────────────────────────────────────

let openaiApiKey = process.env.OPENAI_API_KEY;
let weaviateHost = process.env.WEAVIATE_HOST;
let weaviateApiKey = process.env.WEAVIATE_API_KEY;
let weaviateScheme = process.env.WEAVIATE_SCHEME || 'https';

if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  try {
    const openaiSecret = await getSecret('coaching-tool/openai-api-key');
    openaiApiKey = openaiSecret.OPENAI_API_KEY;
  } catch (err) {
    console.error('Failed to load OpenAI key from Secrets Manager:', err.message);
  }

  try {
    const weaviateCreds = await getSecret('coaching-tool/weaviate-credentials');
    weaviateHost = weaviateCreds.WEAVIATE_HOST;
    weaviateApiKey = weaviateCreds.WEAVIATE_API_KEY;
    weaviateScheme = weaviateCreds.WEAVIATE_SCHEME || 'https';
  } catch (err) {
    console.error('Failed to load Weaviate credentials from Secrets Manager:', err.message);
  }
}

// ── Weaviate ──────────────────────────────────────────────

function resolveHost() {
  const raw = weaviateHost?.trim();
  if (!raw) return { scheme: 'http', host: 'localhost:8080' };

  if (/^https?:\/\//i.test(raw)) {
    const u = new URL(raw);
    return {
      scheme: u.protocol.replace(':', ''),
      host: u.port ? `${u.hostname}:${u.port}` : u.hostname,
    };
  }

  return { scheme: weaviateScheme, host: raw };
}

const { scheme, host } = resolveHost();

export const weaviateClient = weaviate.client({
  scheme,
  host,
  apiKey: weaviateApiKey
    ? new weaviate.ApiKey(weaviateApiKey)
    : undefined,
  headers: { 'X-OpenAI-Api-Key': openaiApiKey || '' },
});

// ── OpenAI ────────────────────────────────────────────────

export const openaiClient = new OpenAI({
  apiKey: openaiApiKey,
});
