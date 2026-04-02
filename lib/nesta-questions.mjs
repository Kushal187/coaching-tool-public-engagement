// lib/nesta-questions.mjs
// Shared definition of the 9 Nesta framework questions.
// Used by the orchestrator, coach agent, and session state.

export const NESTA_QUESTIONS = [
  {
    id: 1,
    question: "Have you articulated the project's goals?",
    explanation:
      'What is the purpose of your public engagement project? What specific outcomes are you trying to achieve? Clear goals help ensure your engagement process stays focused and that participants understand why their input matters.',
  },
  {
    id: 2,
    question: 'Have you identified the right participants?',
    explanation:
      "Who needs to be involved in this engagement? Consider both obvious stakeholders and those who might be affected but aren't immediately visible. Think about diversity, representation, and who holds relevant knowledge or experience.",
  },
  {
    id: 3,
    question: 'Can you reach the participants you identified?',
    explanation:
      'Do you have access channels to your target participants? Consider digital platforms, community networks, physical locations, and any barriers that might prevent participation (language, accessibility, trust, geography).',
  },
  {
    id: 4,
    question: 'Who is the right owner?',
    explanation:
      'Who has the authority and accountability for this engagement process? Who will champion the results and ensure they lead to action? Strong ownership means someone is responsible for follow-through, not just the engagement event itself.',
  },
  {
    id: 5,
    question: 'Have you included incentives for participation?',
    explanation:
      'What motivates people to participate? Consider both tangible incentives (compensation, food, childcare, transportation) and intangible ones (having their voice heard, community impact, learning opportunities). Remove barriers that make participation costly.',
  },
  {
    id: 6,
    question: 'Have you defined the tasks?',
    explanation:
      "What specific activities will participants do? How will they contribute their input or labor? Well-defined tasks help participants understand what's expected and ensure contributions are useful and actionable.",
  },
  {
    id: 7,
    question: 'Have you established the workflow?',
    explanation:
      'What is the step-by-step process from recruitment to completion? How do the pieces fit together? A clear workflow ensures nothing falls through the cracks and participants experience a coherent, well-organized process.',
  },
  {
    id: 8,
    question: 'How will you evaluate inputs?',
    explanation:
      'How will you assess the quality and usefulness of what participants contribute? What criteria will you use? Having an evaluation plan ensures that contributions are handled fairly and that the best ideas surface.',
  },
  {
    id: 9,
    question: 'How will you use what the group creates?',
    explanation:
      "What happens with the engagement outputs? How will participants' contributions influence real decisions? Closing the loop — showing people how their input shaped outcomes — is essential for trust and future participation.",
  },
];

export function getQuestionById(id) {
  return NESTA_QUESTIONS.find((q) => q.id === id) || null;
}

export function formatQuestionsForLLM(questions = NESTA_QUESTIONS) {
  return questions
    .map((q) => `Q${q.id}: "${q.question}" — ${q.explanation}`)
    .join('\n');
}
