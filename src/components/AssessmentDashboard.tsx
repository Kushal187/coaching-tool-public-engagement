import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  CheckCircle2,
  AlertTriangle,
  X as XIcon,
  Loader2,
  BookOpen,
  RefreshCw,
} from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  CoachingChatPanel,
  type AssessmentCard,
  type CardStatus,
} from './CoachingChatPanel';
import type { NestaResponses } from './Coach';
import type { CaseStudy } from '../data/caseStudies';

function getStatusColor(status: CardStatus) {
  switch (status) {
    case 'addressed':
      return {
        bg: 'bg-[#097261]/10',
        border: 'border-[#097261]',
        text: 'text-[#097261]',
      };
    case 'partial':
      return {
        bg: 'bg-[#FDCE3E]/20',
        border: 'border-[#D09006]',
        text: 'text-[#D09006]',
      };
    case 'not-addressed':
      return {
        bg: 'bg-[#9D0C1B]/10',
        border: 'border-[#9D0C1B]',
        text: 'text-[#9D0C1B]',
      };
  }
}

function getStatusIcon(status: CardStatus) {
  switch (status) {
    case 'addressed':
      return <CheckCircle2 className="w-8 h-8 text-[#097261]" />;
    case 'partial':
      return <AlertTriangle className="w-8 h-8 text-[#D09006]" />;
    case 'not-addressed':
      return <XIcon className="w-8 h-8 text-[#9D0C1B]" strokeWidth={3} />;
  }
}

function getStatusLabel(status: CardStatus) {
  switch (status) {
    case 'addressed':
      return 'Addressed';
    case 'partial':
      return 'Partial';
    case 'not-addressed':
      return 'Not Addressed';
  }
}

export function AssessmentDashboard() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<AssessmentCard[]>([]);
  const [responses, setResponses] = useState<NestaResponses>({});
  const [selectedCard, setSelectedCard] = useState<AssessmentCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [caseStudies, setCaseStudies] = useState<
    { study: CaseStudy; score: number; reason?: string }[]
  >([]);
  const [scoringLoading, setScoringLoading] = useState(false);

  useEffect(() => {
    const savedResponses = sessionStorage.getItem('nestaResponses');
    const savedEvaluations = sessionStorage.getItem('nestaEvaluations');

    if (!savedResponses) {
      navigate('/coach');
      return;
    }

    const parsed: NestaResponses = JSON.parse(savedResponses);
    setResponses(parsed);

    if (savedEvaluations) {
      try {
        const evals: AssessmentCard[] = JSON.parse(savedEvaluations);
        setCards(evals);
        setLoading(false);
        return;
      } catch {
        /* fall through to fetch */
      }
    }

    fetchEvaluation(parsed);
  }, [navigate]);

  const fetchEvaluation = async (resp: NestaResponses) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/evaluate-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: resp }),
      });
      if (!res.ok) throw new Error('Evaluation failed');
      const data = await res.json();
      setCards(data.evaluations);
      sessionStorage.setItem(
        'nestaEvaluations',
        JSON.stringify(data.evaluations),
      );
    } catch (err) {
      console.error('Failed to load evaluations:', err);
      setError('Failed to load your assessment. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchCaseStudySuggestions = useCallback(async () => {
    setScoringLoading(true);
    try {
      const allRes = await fetch('/api/case-studies');
      if (!allRes.ok) throw new Error('Failed to fetch case studies');
      const allStudies: CaseStudy[] = await allRes.json();
      if (allStudies.length === 0) {
        setScoringLoading(false);
        return;
      }

      const contextSummary = Object.entries(responses)
        .map(([id, answer]) => `Q${id}: ${answer}`)
        .join('\n');

      const userContext = {
        issueArea: responses[1] || '',
        primaryGoal: responses[1] || '',
        audience: [responses[2] || ''],
        timeline: '',
        resources: [responses[5] || ''],
        biggestConstraint: '',
        aiComfort: '',
        successLooksLike: responses[8] || '',
        stuckPoint: '',
        processStage: '',
      };

      const scoreRes = await fetch('/api/score-case-studies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userContext,
          plan: contextSummary,
          caseStudies: allStudies,
        }),
      });

      if (!scoreRes.ok) throw new Error('Scoring failed');

      const { scores } = await scoreRes.json();
      const studyMap = new Map(allStudies.map((s) => [s.id, s]));
      const ranked = (scores || [])
        .filter((s: { id: string }) => studyMap.has(s.id))
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
        .slice(0, 5)
        .map((s: { id: string; score: number; reason?: string }) => ({
          study: studyMap.get(s.id)!,
          score: s.score,
          reason: s.reason,
        }));
      setCaseStudies(ranked);
    } catch (err) {
      console.error('Case study scoring failed:', err);
    } finally {
      setScoringLoading(false);
    }
  }, [responses]);

  useEffect(() => {
    if (cards.length > 0 && Object.keys(responses).length > 0) {
      fetchCaseStudySuggestions();
    }
  }, [cards.length, responses, fetchCaseStudySuggestions]);

  const handleCardClick = (card: AssessmentCard) => {
    setSelectedCard(card);
  };

  const handleStatusChange = (questionId: number, newStatus: CardStatus) => {
    const updated = cards.map((c) =>
      c.questionId === questionId ? { ...c, status: newStatus } : c,
    );
    setCards(updated);
    sessionStorage.setItem('nestaEvaluations', JSON.stringify(updated));
    setSelectedCard((prev) =>
      prev && prev.questionId === questionId
        ? { ...prev, status: newStatus }
        : prev,
    );
  };

  const addressedCount = cards.filter((c) => c.status === 'addressed').length;
  const canGenerateReflection = addressedCount >= 7;

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-10 h-10 text-[#124D8F] animate-spin" />
          <p className="text-gray-700 font-medium text-lg">
            Analyzing your responses...
          </p>
          <p className="text-sm text-gray-400">
            Our AI is evaluating your assessment against the Nesta framework
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <p className="text-red-600 font-medium">{error}</p>
          <Button onClick={() => fetchEvaluation(responses)}>
            <RefreshCw className="w-4 h-4" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1
          className="text-3xl text-[#124D8F] mb-2"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Assessment Dashboard
        </h1>
        <p className="text-gray-600 text-lg">
          Review your assessment results and click any card to open a coaching
          conversation. Yellow and red cards need attention; green cards can be
          revisited or marked unresolved.
        </p>
        <p className="mt-2 text-gray-500">
          Progress: {addressedCount}/9 addressed
        </p>
      </div>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#097261] rounded-full transition-all duration-500"
            style={{ width: `${(addressedCount / 9) * 100}%` }}
          />
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
        {cards.map((card) => {
          const colors = getStatusColor(card.status);

          return (
            <div
              key={card.questionId}
              onClick={() => handleCardClick(card)}
              className={`${colors.bg} border-2 ${colors.border} rounded-xl p-6 transition-all cursor-pointer hover:shadow-lg hover:scale-[1.02]`}
            >
              <div className="flex justify-between items-start mb-4">
                {getStatusIcon(card.status)}
                <span
                  className={`text-sm px-3 py-1 rounded-full ${colors.text} bg-white/50 font-semibold`}
                >
                  {getStatusLabel(card.status)}
                </span>
              </div>
              <h3 className="text-base font-semibold text-gray-800 mb-3">
                {card.questionId}. {card.question}
              </h3>
              {card.gap && (
                <p className="text-sm text-gray-600 leading-relaxed">
                  {card.gap}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Suggested Case Studies */}
      <div className="mb-12">
        <h2
          className="text-2xl text-[#124D8F] mb-1"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Suggested Case Studies
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Based on your assessment, these case studies may be helpful
        </p>

        {scoringLoading && (
          <div className="flex flex-col items-center justify-center py-10 space-y-3">
            <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
            <p className="text-sm text-gray-500">
              Finding relevant case studies...
            </p>
          </div>
        )}

        {!scoringLoading && caseStudies.length > 0 && (
          <div className="space-y-3">
            {caseStudies.map(({ study, score, reason }, idx) => (
              <Link
                key={study.id}
                to={`/case-studies/${study.id}`}
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-400 hover:shadow-sm transition-all group"
              >
                <div className="flex items-start gap-4">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[#E4EFFC] text-[#124D8F] text-sm font-semibold flex-shrink-0">
                    {idx + 1}
                  </div>
                  <div>
                    <h4 className="font-medium text-[#124D8F] group-hover:underline">
                      {study.title}
                    </h4>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>{study.location}</span>
                      <span>&bull;</span>
                      <span>{study.timeframe}</span>
                      <span>&bull;</span>
                      <span className="capitalize">{study.scale} scale</span>
                    </div>
                    {reason && (
                      <p className="text-xs text-gray-500 mt-1.5 italic">
                        {reason}
                      </p>
                    )}
                    <div className="flex gap-1.5 mt-2">
                      {study.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="text-xs"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Relevance</div>
                    <div className="text-sm font-semibold text-gray-900">
                      {Math.min(Math.round(score), 99)}%
                    </div>
                  </div>
                  <BookOpen className="w-4 h-4 text-gray-400 group-hover:text-[#124D8F] transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}

        {!scoringLoading && caseStudies.length === 0 && (
          <p className="text-sm text-gray-400 italic py-4">
            No case studies available for scoring.
          </p>
        )}
      </div>

      {/* Generate Reflection */}
      <div className="text-center pb-8">
        <Button
          onClick={() => {
            sessionStorage.setItem('nestaEvaluations', JSON.stringify(cards));
            navigate('/coach/reflection');
          }}
          disabled={!canGenerateReflection}
          className="px-10 py-3 text-base"
        >
          Generate Reflection
          {!canGenerateReflection && ` (${7 - addressedCount} more needed)`}
        </Button>
        {!canGenerateReflection && (
          <p className="mt-3 text-sm text-gray-400">
            Address at least 7 of 9 questions to generate your reflection
          </p>
        )}
      </div>

      {/* Coaching chat panel */}
      {selectedCard && (
        <CoachingChatPanel
          card={selectedCard}
          userResponse={responses[selectedCard.questionId] || ''}
          onClose={() => setSelectedCard(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
