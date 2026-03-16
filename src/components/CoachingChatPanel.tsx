import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Loader2,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import { MarkdownContent } from './ui/markdown-content';
import coachingTemplate from '../../prompts/coaching-context.txt?raw';

export type CardStatus = 'addressed' | 'partial' | 'not-addressed';

export interface AssessmentCard {
  questionId: number;
  question: string;
  status: CardStatus;
  gap: string;
  coachingContext: string;
}

interface Message {
  role: 'ai' | 'user';
  content: string;
}

interface CoachingChatPanelProps {
  card: AssessmentCard;
  allCards: AssessmentCard[];
  userResponse: string;
  onStatusChange: (questionId: number, newStatus: CardStatus) => void;
}

function loadChatHistory(questionId: number): Message[] | null {
  try {
    const saved = sessionStorage.getItem(`nestaChat_${questionId}`);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return null;
}

function saveChatHistory(questionId: number, messages: Message[]) {
  sessionStorage.setItem(`nestaChat_${questionId}`, JSON.stringify(messages));
}

const COACHING_CONTEXT_PREFIX = (
  question: string,
  userResponse: string,
  gap: string,
  status: CardStatus,
) =>
  coachingTemplate
    .replace('{{question}}', question)
    .replace('{{userResponse}}', userResponse)
    .replace('{{status}}', status)
    .replace('{{gap}}', gap || 'None — this was marked as addressed.');

export function CoachingChatPanel({
  card,
  allCards,
  userResponse,
  onStatusChange,
}: CoachingChatPanelProps) {
  const [currentStatus, setCurrentStatus] = useState<CardStatus>(card.status);
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = loadChatHistory(card.questionId);
    if (saved && saved.length > 0) return saved;
    return [{ role: 'ai' as const, content: card.coachingContext }];
  });
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrentStatus(card.status);
    const saved = loadChatHistory(card.questionId);
    if (saved && saved.length > 0) {
      setMessages(saved);
    } else {
      setMessages([{ role: 'ai' as const, content: card.coachingContext }]);
    }
    setInput('');
  }, [card.questionId, card.status, card.coachingContext]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [card.questionId]);

  useEffect(() => {
    saveChatHistory(card.questionId, messages);
  }, [messages, card.questionId]);

  const buildConversation = useCallback(
    (msgs: Message[]) => {
      const prefix = COACHING_CONTEXT_PREFIX(
        card.question,
        userResponse,
        card.gap,
        currentStatus,
      );

      return [
        { type: 'user', content: prefix },
        { type: 'bot', content: msgs[0]?.content || card.coachingContext },
        ...msgs.slice(1).map((m) => ({
          type: m.role === 'ai' ? 'bot' : 'user',
          content: m.content,
        })),
      ];
    },
    [card, userResponse, currentStatus],
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const newMessages: Message[] = [
      ...messages,
      { role: 'user', content: text },
    ];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);

    try {
      const conversation = buildConversation(newMessages);

      const res = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversation }),
      });

      if (!res.ok) throw new Error('Chat request failed');

      const responseText = await res.text();
      const lines = responseText.split('\n');
      let botContent = '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) botContent += parsed.content;
        } catch {
          /* skip malformed */
        }
      }

      if (botContent) {
        const updatedMessages: Message[] = [...newMessages, { role: 'ai', content: botContent }];
        setMessages(() => updatedMessages);
        await analyzeCrossResolution(updatedMessages);
      }
    } catch (err) {
      console.error('Coaching chat error:', err);
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          content: "I'm sorry, I encountered an error. Please try again.",
        },
      ]);
    } finally {
      setStreaming(false);
    }
  };

  const analyzeCrossResolution = async (msgs: Message[]) => {
    const currentAlreadyResolved = currentStatus === 'addressed';
    const unresolvedCards = allCards
      .filter((c) => c.status !== 'addressed' && c.questionId !== card.questionId)
      .map((c) => ({ questionId: c.questionId, question: c.question, gap: c.gap }));

    if (unresolvedCards.length === 0 && currentAlreadyResolved) return;

    try {
      const conversationForAnalysis = msgs
        .filter((m) => m.role === 'user' || m.role === 'ai')
        .map((m) => ({ role: m.role === 'ai' ? 'coach' : 'user', content: m.content }));

      const res = await fetch('/api/analyze-cross-resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation: conversationForAnalysis,
          currentQuestionId: card.questionId,
          currentQuestion: { question: card.question, gap: card.gap },
          unresolvedCards,
        }),
      });

      if (!res.ok) return;

      const { resolvedQuestionIds, currentQuestionResolved } = await res.json();

      const newMessages: Message[] = [];

      if (currentQuestionResolved && !currentAlreadyResolved) {
        setCurrentStatus('addressed');
        onStatusChange(card.questionId, 'addressed');
        newMessages.push({
          role: 'ai',
          content:
            `Based on our conversation, it looks like you've substantively addressed the gap for this question. I've automatically marked it as **resolved**. You can change this from the dashboard if needed.`,
        });
      }

      const crossIds = Array.isArray(resolvedQuestionIds) ? resolvedQuestionIds : [];
      if (crossIds.length > 0) {
        const resolvedNames = crossIds
          .map((id: number) => {
            const c = allCards.find((ac) => ac.questionId === id);
            return c ? `**Q${id}:** ${c.question}` : `Q${id}`;
          })
          .join('\n- ');

        for (const id of crossIds) {
          onStatusChange(id, 'addressed');
        }

        try {
          const prev = JSON.parse(sessionStorage.getItem('nestaCrossResolved') || '[]');
          const merged = [...new Set([...prev, ...crossIds])];
          sessionStorage.setItem('nestaCrossResolved', JSON.stringify(merged));
        } catch { /* ignore */ }

        newMessages.push({
          role: 'ai',
          content:
            `Based on our conversation, the following assessment question${crossIds.length > 1 ? 's were' : ' was'} also resolved:\n\n- ${resolvedNames}\n\nYou can revisit ${crossIds.length > 1 ? 'them' : 'it'} from the dashboard if needed.`,
        });
      }

      if (newMessages.length > 0) {
        setMessages((prev) => [...prev, ...newMessages]);
      }
    } catch {
      /* cross-resolution is best-effort; don't disrupt the chat */
    }
  };

  const handleToggleStatus = () => {
    if (currentStatus === 'addressed') {
      setCurrentStatus('partial');
      onStatusChange(card.questionId, 'partial');
    } else {
      setCurrentStatus('addressed');
      onStatusChange(card.questionId, 'addressed');
    }
  };

  const isResolved = currentStatus === 'addressed';

  return (
    <div className="h-full bg-white flex flex-col">
      {/* Header with status toggle */}
      <div className="bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between flex-shrink-0">
        <div className="min-w-0 flex-1 mr-4">
          <h2
            className="text-lg text-[#124D8F]"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Coaching Chat
          </h2>
          <p className="text-sm text-gray-500 mt-0.5 truncate">{card.question}</p>
        </div>
        <button
          type="button"
          onClick={handleToggleStatus}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors cursor-pointer font-semibold text-sm flex-shrink-0 ${
            isResolved
              ? 'bg-amber-50 text-[#D09006] border border-[#D09006] hover:bg-amber-100'
              : 'bg-[#097261] text-white hover:bg-[#097261]/90'
          }`}
        >
          {isResolved ? (
            <>
              <RotateCcw className="w-4 h-4" />
              Mark as Unresolved
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Mark as Resolved
            </>
          )}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] p-4 rounded-xl ${
                message.role === 'user'
                  ? 'bg-[#124D8F] text-white'
                  : 'bg-[#E4EFFC] text-gray-800'
              }`}
            >
              {message.role === 'ai' ? (
                <MarkdownContent>{message.content}</MarkdownContent>
              ) : (
                <p className="leading-relaxed">{message.content}</p>
              )}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="flex justify-start">
            <div className="bg-[#E4EFFC] text-gray-800 p-4 rounded-xl">
              <Loader2 className="w-5 h-5 animate-spin text-[#124D8F]" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-5 border-t flex-shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type your response..."
            disabled={streaming}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#124D8F] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="bg-[#124D8F] text-white px-5 py-3 rounded-lg hover:bg-[#097261] transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
