import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from './ui/button';

const NESTA_QUESTIONS = [
  {
    id: 1,
    question: "Have you articulated the project's goals?",
    explanation:
      "What is the purpose of your public engagement project? What specific outcomes are you trying to achieve? Clear goals help ensure your engagement process stays focused and that participants understand why their input matters.",
    placeholder:
      "Describe your project's goals and the specific outcomes you hope to achieve...",
  },
  {
    id: 2,
    question: 'Have you identified the right participants?',
    explanation:
      "Who needs to be involved in this engagement? Consider both obvious stakeholders and those who might be affected but aren't immediately visible. Think about diversity, representation, and who holds relevant knowledge or experience.",
    placeholder:
      'Describe who you plan to involve and how you identified them...',
  },
  {
    id: 3,
    question: 'Can you reach the participants you identified?',
    explanation:
      'Do you have access channels to your target participants? Consider digital platforms, community networks, physical locations, and any barriers that might prevent participation (language, accessibility, trust, geography).',
    placeholder:
      'Describe how you plan to reach and recruit your target participants...',
  },
  {
    id: 4,
    question: 'Who is the right owner?',
    explanation:
      'Who has the authority and accountability for this engagement process? Who will champion the results and ensure they lead to action? Strong ownership means someone is responsible for follow-through, not just the engagement event itself.',
    placeholder:
      'Describe who owns this process and who will act on the results...',
  },
  {
    id: 5,
    question: 'Have you included incentives for participation?',
    explanation:
      'What motivates people to participate? Consider both tangible incentives (compensation, food, childcare, transportation) and intangible ones (having their voice heard, community impact, learning opportunities). Remove barriers that make participation costly.',
    placeholder:
      'Describe what incentives or support you offer to encourage participation...',
  },
  {
    id: 6,
    question: 'Have you defined the tasks?',
    explanation:
      "What specific activities will participants do? How will they contribute their input or labor? Well-defined tasks help participants understand what's expected and ensure contributions are useful and actionable.",
    placeholder:
      'Describe the specific tasks or activities participants will undertake...',
  },
  {
    id: 7,
    question: 'Have you established the workflow?',
    explanation:
      'What is the step-by-step process from recruitment to completion? How do the pieces fit together? A clear workflow ensures nothing falls through the cracks and participants experience a coherent, well-organized process.',
    placeholder:
      'Describe your end-to-end workflow from start to finish...',
  },
  {
    id: 8,
    question: 'How will you evaluate inputs?',
    explanation:
      'How will you assess the quality and usefulness of what participants contribute? What criteria will you use? Having an evaluation plan ensures that contributions are handled fairly and that the best ideas surface.',
    placeholder:
      'Describe how you will review, assess, and prioritize participant inputs...',
  },
  {
    id: 9,
    question: 'How will you use what the group creates?',
    explanation:
      "What happens with the engagement outputs? How will participants' contributions influence real decisions? Closing the loop — showing people how their input shaped outcomes — is essential for trust and future participation.",
    placeholder:
      'Describe how participant contributions will be used and how you will communicate outcomes back...',
  },
];

export type NestaResponses = Record<number, string>;

export function Coach() {
  const navigate = useNavigate();
  const [responses, setResponses] = useState<NestaResponses>(() => {
    const saved = sessionStorage.getItem('nestaResponses');
    if (saved) {
      try { return JSON.parse(saved); } catch { /* ignore */ }
    }
    return {};
  });
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (id: number, value: string) => {
    setResponses((prev) => ({ ...prev, [id]: value }));
  };

  const answeredCount = NESTA_QUESTIONS.filter(
    (q) => (responses[q.id] || '').trim().length > 0,
  ).length;
  const allAnswered = answeredCount === NESTA_QUESTIONS.length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allAnswered) return;

    setSubmitting(true);
    sessionStorage.setItem('nestaResponses', JSON.stringify(responses));

    try {
      const res = await fetch('/api/evaluate-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses }),
      });

      if (!res.ok) throw new Error('Evaluation failed');

      const data = await res.json();
      sessionStorage.setItem('nestaEvaluations', JSON.stringify(data.evaluations));
      navigate('/coach/dashboard');
    } catch (err) {
      console.error('Assessment evaluation failed:', err);
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-10">
        <h1
          className="text-3xl text-[#124D8F] mb-2"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Coaching Assessment
        </h1>
        <p className="text-gray-600 text-lg">
          Answer the 9 questions below to help us understand your public
          engagement project. Each question includes an explanation to guide your
          thinking. Your responses will be analyzed to identify strengths and
          areas for improvement.
        </p>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#124D8F] rounded-full transition-all duration-300"
            style={{ width: `${(answeredCount / 9) * 100}%` }}
          />
        </div>
        <span className="text-sm text-gray-500 whitespace-nowrap">
          {answeredCount} of 9 answered
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {NESTA_QUESTIONS.map((q) => (
          <div
            key={q.id}
            className={`bg-white border-2 rounded-xl p-6 transition-colors ${
              (responses[q.id] || '').trim()
                ? 'border-[#124D8F]/30'
                : 'border-[#E4EFFC] hover:border-[#124D8F]/40'
            }`}
          >
            <label className="block mb-2">
              <span
                className="text-lg font-semibold text-[#124D8F]"
                style={{ fontFamily: "'DM Serif Display', serif" }}
              >
                {q.id}. {q.question}
              </span>
            </label>
            <p className="text-gray-500 text-sm mb-4 leading-relaxed">
              {q.explanation}
            </p>
            <textarea
              value={responses[q.id] || ''}
              onChange={(e) => handleChange(q.id, e.target.value)}
              placeholder={q.placeholder}
              className="w-full min-h-[120px] px-4 py-3 border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#124D8F] focus:border-transparent resize-y"
            />
          </div>
        ))}

        <div className="pt-4 pb-8 text-center">
          <Button
            type="submit"
            disabled={!allAnswered || submitting}
            className="px-10 py-3 text-base"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing your responses...
              </>
            ) : (
              <>
                Complete Assessment
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
          {!allAnswered && (
            <p className="mt-3 text-sm text-gray-400">
              Please answer all 9 questions to continue
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
