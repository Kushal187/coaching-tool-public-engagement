import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(__dirname, file), 'utf-8');

// NOTE: The layer mirror intentionally carries ONLY the prompts that deployed
// Lambdas actually need. The full set of runtime prompts (orchestrator,
// coach-agent-open, coach-agent-continue, retrieval-agent, suggest-next,
// general, generate-reflection) live in the root prompts/ folder and are
// loaded by server.mjs, which is not packaged as a Lambda.
export const CLASSIFY_SYSTEM = read('classify-document.txt');
