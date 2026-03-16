import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(__dirname, file), 'utf-8');

export const CHATBOT_PROMPT = read('chatbot.txt');
export const GENERATE_PLAN_PROMPT = read('generate-plan.txt');
export const GENERATE_QUESTIONS_PROMPT = read('generate-questions.txt');
export const ADAPT_CASE_STUDY_PROMPT = read('adapt-case-study.txt');
export const EVALUATE_COACHING_PROMPT = read('evaluate-coaching.txt');
export const CROSS_RESOLUTION_PROMPT = read('cross-resolution.txt');
export const GENERATE_SCENARIO_PROMPT = read('generate-scenario.txt');
export const SCENARIO_DESCRIPTIONS = JSON.parse(read('scenario-descriptions.json'));
export const EVALUATE_ASSESSMENT_PROMPT = read('evaluate-assessment.txt');
export const GENERATE_REFLECTION_PROMPT = read('generate-reflection.txt');
export const SCORE_CASE_STUDIES_PROMPT = read('score-case-studies.txt');
export const CLASSIFY_SYSTEM = read('classify-document.txt');
