import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  Loader2,
  RefreshCw,
  MessageSquare,
  ChevronDown,
} from 'lucide-react';
import { Button } from './ui/button';
import {
  CoachingChatPanel,
  type AssessmentCard,
  type CardStatus,
} from './CoachingChatPanel';
import type { NestaResponses } from './Coach';

const STATUS_GROUPS: { status: CardStatus; label: string; color: string }[] = [
  { status: 'partial', label: 'Partial', color: 'text-[#D09006]' },
  { status: 'not-addressed', label: 'Not Addressed', color: 'text-[#6B7280]' },
  { status: 'addressed', label: 'Addressed', color: 'text-[#097261]' },
];

export function AssessmentDashboard() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<AssessmentCard[]>([]);
  const [responses, setResponses] = useState<NestaResponses>({});
  const [selectedCard, setSelectedCard] = useState<AssessmentCard | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<CardStatus>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
        if (!sessionStorage.getItem('nestaInitiallyAddressed')) {
          const initiallyAddressed = evals
            .filter((e) => e.status === 'addressed')
            .map((e) => e.questionId);
          sessionStorage.setItem('nestaInitiallyAddressed', JSON.stringify(initiallyAddressed));
        }
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
      const initiallyAddressed = data.evaluations
        .filter((e: AssessmentCard) => e.status === 'addressed')
        .map((e: AssessmentCard) => e.questionId);
      sessionStorage.setItem('nestaInitiallyAddressed', JSON.stringify(initiallyAddressed));
    } catch (err) {
      console.error('Failed to load evaluations:', err);
      setError('Failed to load your assessment. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCardClick = (card: AssessmentCard) => {
    setSelectedCard(card);
  };

  const toggleGroup = (status: CardStatus) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
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
    <div className="flex h-[calc(100vh-64px)]">
      {/* Left panel — accordion sidebar */}
      <div className="w-[420px] min-w-[360px] border-r border-gray-200 flex flex-col overflow-hidden bg-gray-50/50">
        <div className="p-6 flex-shrink-0">
          <h1
            className="text-2xl text-[#124D8F] mb-2"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Assessment Dashboard
          </h1>
          <p className="text-gray-600 text-sm leading-relaxed">
            Select a question to start a coaching conversation. Colour indicates status.
          </p>
          <p className="mt-2 text-gray-500 text-sm">
            Progress: {addressedCount}/9 addressed
          </p>

          {/* Progress bar */}
          <div className="mt-3">
            <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#097261] rounded-full transition-all duration-500"
                style={{ width: `${(addressedCount / 9) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Grouped accordion */}
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-3">
          {STATUS_GROUPS.map(({ status, label, color }) => {
            const groupCards = cards.filter((c) => c.status === status);
            if (groupCards.length === 0) return null;
            const isCollapsed = collapsedGroups.has(status);

            return (
              <div key={status} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleGroup(status)}
                  className="w-full flex items-center justify-between px-5 py-4 cursor-pointer group"
                >
                  <span className={`text-sm font-semibold ${color}`}>
                    {label} ({groupCards.length})
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 transition-transform duration-200 group-hover:text-gray-600 ${
                      isCollapsed ? '-rotate-90' : ''
                    }`}
                  />
                </button>

                <div
                  className="border-t border-gray-100 overflow-hidden transition-all duration-300 ease-in-out"
                  style={{
                    maxHeight: isCollapsed ? '0px' : `${groupCards.length * 60}px`,
                    opacity: isCollapsed ? 0 : 1,
                  }}
                >
                  {groupCards.map((card, idx) => {
                    const isSelected = selectedCard?.questionId === card.questionId;

                    return (
                      <button
                        key={card.questionId}
                        type="button"
                        onClick={() => handleCardClick(card)}
                        className={`w-full text-left px-5 py-3.5 transition-colors cursor-pointer ${
                          idx < groupCards.length - 1 ? 'border-b border-gray-100' : ''
                        } ${
                          isSelected
                            ? 'bg-[#E4EFFC]'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <p className="text-sm font-semibold text-gray-800 leading-snug">
                          {card.questionId}. {card.question}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Generate Reflection */}
        <div className="p-6 border-t border-gray-200 flex-shrink-0 bg-gray-50/80">
          <Button
            onClick={() => {
              sessionStorage.setItem('nestaEvaluations', JSON.stringify(cards));
              navigate('/coach/reflection');
            }}
            disabled={!canGenerateReflection}
            className="w-full py-2.5 text-sm"
          >
            Generate Reflection
            {!canGenerateReflection && ` (${7 - addressedCount} more needed)`}
          </Button>
          {!canGenerateReflection && (
            <p className="mt-2 text-xs text-gray-400 text-center">
              Address at least 7 of 9 questions to generate your reflection
            </p>
          )}
        </div>
      </div>

      {/* Right panel — chat */}
      <div className="flex-1 min-w-0">
        {selectedCard ? (
          <CoachingChatPanel
            card={selectedCard}
            allCards={cards}
            userResponse={responses[selectedCard.questionId] || ''}
            onStatusChange={handleStatusChange}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 px-8">
            <MessageSquare className="w-16 h-16 mb-4 text-gray-300" />
            <h2
              className="text-xl text-gray-500 mb-2"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              Select a question to begin
            </h2>
            <p className="text-sm text-center max-w-md leading-relaxed">
              Choose a question from the panel on the left to open a coaching
              conversation. Your chat history for each question is saved
              automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
