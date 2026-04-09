import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(__dirname, file), 'utf-8');

export const GENERATE_REFLECTION_PROMPT = read('generate-reflection.txt');
export const CLASSIFY_SYSTEM = read('classify-document.txt');
export const ORCHESTRATOR_PROMPT = read('orchestrator.txt');
export const COACH_AGENT_OPEN_PROMPT = read('coach-agent-open.txt');
export const COACH_AGENT_CONTINUE_PROMPT = read('coach-agent-continue.txt');
export const RETRIEVAL_AGENT_PROMPT = read('retrieval-agent.txt');
export const SUGGEST_NEXT_PROMPT = read('suggest-next.txt');
export const GENERAL_PROMPT = read('general.txt');
