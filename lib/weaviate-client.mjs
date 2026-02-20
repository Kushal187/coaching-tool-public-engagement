// lib/weaviate-client.mjs
// ─────────────────────────────────────────────────────────────
// Shared Weaviate + OpenAI client initialisation.
// ─────────────────────────────────────────────────────────────

import 'dotenv/config';
import weaviate from 'weaviate-ts-client';
import { OpenAI } from 'openai';

// ──── Weaviate ──────────────────────────────────────────────

function resolveHost() {
  const raw = process.env.WEAVIATE_HOST?.trim();
  if (!raw) return { scheme: 'http', host: 'localhost:8080' };

  if (/^https?:\/\//i.test(raw)) {
    const u = new URL(raw);
    return {
      scheme: u.protocol.replace(':', ''),
      host: u.port ? `${u.hostname}:${u.port}` : u.hostname,
    };
  }

  return { scheme: process.env.WEAVIATE_SCHEME || 'https', host: raw };
}

const { scheme, host } = resolveHost();

export const weaviateClient = weaviate.client({
  scheme,
  host,
  apiKey: process.env.WEAVIATE_API_KEY
    ? new weaviate.ApiKey(process.env.WEAVIATE_API_KEY)
    : undefined,
  headers: { 'X-OpenAI-Api-Key': process.env.OPENAI_API_KEY || '' },
});

// ──── OpenAI ────────────────────────────────────────────────

export const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
