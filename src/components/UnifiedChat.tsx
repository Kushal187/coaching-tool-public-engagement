import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Send, Loader2, User, Bot, FileText } from 'lucide-react';
import { MarkdownContent } from './ui/markdown-content';

// ── Types ──────────────────────────────────────────────────

type SessionSummary = {
  activeQuestionId: number | null;
  addressedCount: number;
  inProgressCount: number;
  totalQuestions: number;
  questions: { id: number; question: string; status: string; hasCoachingHistory: boolean }[];
};

type Suggestion = {
  questionId: number;
  reason: string;
};

type MessageMetadata = {
  sessionId?: string;
  handler?: string;
  questionId?: number | null;
  resolved?: boolean;
  suggestions?: Suggestion[] | null;
  sessionSummary?: SessionSummary;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: MessageMetadata;
  isStreaming?: boolean;
};

// ── SSE fetch helper ───────────────────────────────────────

async function fetchChatSSE(
  sessionId: string,
  message: string,
  onChunk: (content: string) => void,
  onMetadata: (meta: MessageMetadata) => void,
  onDone: () => void,
  onError: (err: string) => void,
) {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message }),
    });

    if (!res.ok) {
      onError('Sorry, something went wrong. Please try again.');
      return;
    }

    const text = await res.text();
    const lines = text.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;

      try {
        const parsed = JSON.parse(data);
        if (parsed.content) onChunk(parsed.content);
        if (parsed.metadata) onMetadata(parsed.metadata);
      } catch {
        /* skip malformed lines */
      }
    }

    onDone();
  } catch {
    onError('Could not connect to the server. Please check your connection and try again.');
  }
}

// ── Welcome message ────────────────────────────────────────

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content:
    "Hi! I'm your public engagement coach. I can help you design and improve your public engagement projects using the Nesta framework.\n\n**What public engagement challenge are you working on today?**",
};

// ── Component ──────────────────────────────────────────────

export function UnifiedChat() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialMessage = (location.state as { initialMessage?: string })?.initialMessage;

  const [sessionId] = useState(() => `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const initialBotId = `bot-initial-${Date.now()}`;

  // If there's an initial message from Home, start with it already visible
  const [messages, setMessages] = useState<Message[]>(() => {
    if (initialMessage) {
      return [
        WELCOME_MESSAGE,
        { id: 'user-initial', role: 'user', content: initialMessage },
        { id: initialBotId, role: 'assistant', content: '', isStreaming: true },
      ];
    }
    return [WELCOME_MESSAGE];
  });
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(!!initialMessage);
  const [lastMetadata, setLastMetadata] = useState<MessageMetadata | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initialFired = useRef(false);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, [isLoading]);

  // Fire the API call for the initial message from Home page
  useEffect(() => {
    if (!initialMessage || initialFired.current) return;
    initialFired.current = true;

    const botId = initialBotId;
    fetchChatSSE(
      sessionId,
      initialMessage,
      (chunk) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, content: m.content + chunk } : m,
          ),
        );
      },
      (meta) => {
        setLastMetadata(meta);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, metadata: meta } : m,
          ),
        );
      },
      () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, isStreaming: false } : m,
          ),
        );
        setIsLoading(false);
      },
      (errMsg) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, content: errMsg, isStreaming: false } : m,
          ),
        );
        setIsLoading(false);
      },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Core send function — used by handleSend and suggestion clicks
  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    };

    const botId = `bot-${Date.now()}`;
    const botPlaceholder: Message = {
      id: botId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, botPlaceholder]);
    setIsLoading(true);
    setInputValue('');

    fetchChatSSE(
      sessionId,
      text,
      (chunk) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, content: m.content + chunk } : m,
          ),
        );
      },
      (meta) => {
        setLastMetadata(meta);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, metadata: meta } : m,
          ),
        );
      },
      () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, isStreaming: false } : m,
          ),
        );
        setIsLoading(false);
      },
      (errMsg) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId
              ? { ...m, content: errMsg, isStreaming: false }
              : m,
          ),
        );
        setIsLoading(false);
      },
    );
  }, [sessionId]);

  const handleSend = useCallback(() => {
    if (isLoading) return;
    sendMessage(inputValue.trim());
  }, [inputValue, isLoading, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle clicking a suggestion chip
  const handleSuggestionClick = (suggestion: Suggestion) => {
    const question = lastMetadata?.sessionSummary?.questions.find(
      (q) => q.id === suggestion.questionId,
    );
    if (question) {
      sendMessage(`Let's work on: ${question.question}`);
    }
  };

  const summary = lastMetadata?.sessionSummary;
  const addressedCount = summary?.addressedCount ?? 0;

  return (
    <div className="flex flex-col h-[calc(100vh-73px)] max-w-3xl mx-auto overflow-hidden">
      {/* Reflection button — always available so users can exit at any point */}
      {addressedCount > 0 && (
        <div className="px-4 pt-3 pb-1 flex justify-end">
          <button
            onClick={() => navigate('/coach/reflection', { state: { sessionId } })}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#124D8F] bg-[#E4EFFC] rounded-full hover:bg-[#d0e2f7] transition-colors cursor-pointer"
          >
            <FileText className="w-3 h-3" />
            Generate Reflection
          </button>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.map((message) => (
          <div key={message.id}>
            <div
              className={`flex gap-3 ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {/* Avatar */}
              {message.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-[#124D8F] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}

              {/* Bubble */}
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-[#124D8F] text-white'
                    : 'bg-[#F4F7FB] text-gray-900'
                }`}
              >
                {message.content ? (
                  message.role === 'assistant' ? (
                    <MarkdownContent>
                      {message.content.replace(/###\s*Sources[\s\S]*$/, '').trim()}
                    </MarkdownContent>
                  ) : (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                  )
                ) : (
                  message.isStreaming && (
                    <span className="inline-flex items-center gap-2 text-gray-400 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Thinking...
                    </span>
                  )
                )}
              </div>

              {/* User avatar */}
              {message.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-[#FDCE3E] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-[#124D8F]" />
                </div>
              )}
            </div>

            {/* Suggestion chips */}
            {message.role === 'assistant' &&
              !message.isStreaming &&
              message.metadata?.suggestions &&
              message.metadata.suggestions.length > 0 && (
                <div className="ml-11 mt-3 flex flex-wrap gap-2">
                  {message.metadata.suggestions.map((s) => {
                    const q = summary?.questions.find((q) => q.id === s.questionId);
                    return (
                      <button
                        key={s.questionId}
                        onClick={() => handleSuggestionClick(s)}
                        disabled={isLoading}
                        className="px-3 py-1.5 text-xs font-medium text-[#124D8F] bg-white border border-[#124D8F]/20 rounded-full hover:bg-[#E4EFFC] hover:border-[#124D8F]/40 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {q?.question ?? `Question ${s.questionId}`}
                      </button>
                    );
                  })}
                </div>
              )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tell me about your public engagement project..."
            rows={1}
            className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#124D8F] focus:border-transparent leading-relaxed max-h-32 overflow-y-auto"
            disabled={isLoading}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 128) + 'px';
            }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            className="px-3 py-2.5 bg-[#124D8F] text-white rounded-xl hover:bg-[#0e3d72] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex-shrink-0"
            aria-label="Send message"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-center text-xs text-gray-400 mt-2">
          Responses are grounded in our curated knowledge base of public engagement resources.
        </p>
      </div>
    </div>
  );
}
