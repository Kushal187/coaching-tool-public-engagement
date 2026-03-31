import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { API, postBody } from '../api-config';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Badge } from './ui/badge';

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

const SCENARIOS = [
  {
    id: 'well-prepared',
    label: 'Well-Prepared Practitioner',
    description: 'Thorough, detailed, and actionable responses',
    color: 'bg-green-100 text-green-800 border-green-200',
  },
  {
    id: 'vague-minimal',
    label: 'Vague / Minimal Effort',
    description: 'Generic, non-specific filler responses',
    color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    adversarial: true,
  },
  {
    id: 'contradictory',
    label: 'Contradictory Responses',
    description: 'Internally inconsistent answers across questions',
    color: 'bg-orange-100 text-orange-800 border-orange-200',
    adversarial: true,
  },
  {
    id: 'off-topic',
    label: 'Off-Topic / Confused',
    description: 'Misunderstands questions or conflates concepts',
    color: 'bg-red-100 text-red-800 border-red-200',
    adversarial: true,
  },
  {
    id: 'over-ambitious',
    label: 'Over-Ambitious',
    description: 'Grand plans with unrealistic scope and resources',
    color: 'bg-purple-100 text-purple-800 border-purple-200',
    adversarial: true,
  },
  {
    id: 'hostile-resistant',
    label: 'Hostile / Resistant',
    description: 'Skeptical, dismissive, or forced participation',
    color: 'bg-red-100 text-red-800 border-red-200',
    adversarial: true,
  },
  {
    id: 'custom',
    label: 'Custom Scenario',
    description: 'Describe your own scenario for the AI to generate',
    color: 'bg-blue-100 text-blue-800 border-blue-200',
  },
] as const;

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
  const [scenarioDialogOpen, setScenarioDialogOpen] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [customDescription, setCustomDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const handleGenerateScenario = async () => {
    if (!selectedScenario) return;
    if (selectedScenario === 'custom' && !customDescription.trim()) return;

    setGenerating(true);
    setGenerationError(null);

    try {
      const res = await fetch(...postBody(API.generateScenarioResponses, {
        scenario: selectedScenario,
        customDescription: selectedScenario === 'custom' ? customDescription : undefined,
      }));

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Failed to generate responses');
      }

      const data = await res.json();

      const newResponses: NestaResponses = {};
      for (const [key, value] of Object.entries(data.responses)) {
        newResponses[Number(key)] = value as string;
      }
      setResponses(newResponses);
      sessionStorage.setItem('nestaResponses', JSON.stringify(newResponses));
      setScenarioDialogOpen(false);
      setSelectedScenario(null);
      setCustomDescription('');
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setGenerating(false);
    }
  };

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
      const res = await fetch(...postBody(API.evaluateAssessment, { responses }));

      if (!res.ok) throw new Error('Evaluation failed');

      const data = await res.json();
      sessionStorage.setItem('nestaEvaluations', JSON.stringify(data.evaluations));
      const initiallyAddressed = data.evaluations
        .filter((e: { status: string }) => e.status === 'addressed')
        .map((e: { questionId: number }) => e.questionId);
      sessionStorage.setItem('nestaInitiallyAddressed', JSON.stringify(initiallyAddressed));
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

        <div className="mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setScenarioDialogOpen(true)}
            className="gap-2 border-[#124D8F]/30 text-[#124D8F] hover:bg-[#124D8F]/5"
          >
            <Sparkles className="w-4 h-4" />
            Generate Scenario Responses
          </Button>
        </div>
      </div>

      <Dialog open={scenarioDialogOpen} onOpenChange={setScenarioDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-[#124D8F]" style={{ fontFamily: "'DM Serif Display', serif" }}>
              Generate Scenario Responses
            </DialogTitle>
            <DialogDescription>
              Select a scenario to auto-fill all 9 questions with AI-generated
              responses. Use this to test how the coaching tool handles different
              practitioner profiles.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-2 max-h-[400px] overflow-y-auto">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSelectedScenario(s.id);
                  setGenerationError(null);
                }}
                className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                  selectedScenario === s.id
                    ? 'border-[#124D8F] bg-[#E4EFFC]/50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm text-gray-900">{s.label}</span>
                  {'adversarial' in s && s.adversarial && (
                    <Badge variant="outline" className="text-[10px] py-0 border-orange-300 text-orange-600">
                      <AlertTriangle className="w-3 h-3" />
                      Adversarial
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-gray-500">{s.description}</p>
              </button>
            ))}
          </div>

          {selectedScenario === 'custom' && (
            <textarea
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              placeholder="Describe the practitioner persona and their situation (e.g., 'A first-time facilitator running a rushed community consultation with no budget')..."
              className="w-full min-h-[80px] px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#124D8F] focus:border-transparent resize-y"
            />
          )}

          {generationError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">
              {generationError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setScenarioDialogOpen(false);
                setSelectedScenario(null);
                setGenerationError(null);
              }}
              disabled={generating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleGenerateScenario}
              disabled={
                !selectedScenario ||
                generating ||
                (selectedScenario === 'custom' && !customDescription.trim())
              }
              className="gap-2"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
