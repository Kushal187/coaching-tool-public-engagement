import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Upload, Paperclip, Loader2, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';

type SourceDoc = {
  title: string;
  sourceFile: string;
  sourceUrl: string;
  contentType: string | null;
  contentTypeLabel: string | null;
};

type Message = {
  id: string;
  type: 'user' | 'bot';
  content: string;
  attachment?: string;
  sources?: SourceDoc[];
  isStreaming?: boolean;
};

async function fetchBotResponse(
  userMessage: string,
  conversation: Message[],
  onChunk: (content: string) => void,
  onSources: (sources: SourceDoc[]) => void,
  onDone: () => void,
  onError: (err: string) => void,
) {
  try {
    const res = await fetch('/.netlify/functions/chatbot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMessage, conversation }),
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
        if (parsed.sourceDocuments) onSources(parsed.sourceDocuments);
      } catch { /* skip malformed lines */ }
    }

    onDone();
  } catch {
    onError('Could not connect to the server. Please check your connection and try again.');
  }
}

export function ChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'bot',
      content:
        "Hi! I'm your public engagement assistant. I can help answer questions about engagement methods, case studies, and best practices — all grounded in our curated knowledge base. What would you like to know?",
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = () => {
    if ((!inputValue.trim() && !uploadedFile) || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: inputValue || '(Uploaded a plan document)',
      attachment: uploadedFile || undefined,
    };

    const botMessageId = (Date.now() + 1).toString();
    const botPlaceholder: Message = {
      id: botMessageId,
      type: 'bot',
      content: '',
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMessage, botPlaceholder]);
    setIsLoading(true);
    const sentMessage = inputValue;
    setInputValue('');
    setUploadedFile(null);

    fetchBotResponse(
      sentMessage,
      [...messages, userMessage],
      (chunk) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMessageId ? { ...m, content: m.content + chunk } : m,
          ),
        );
      },
      (sources) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMessageId ? { ...m, sources } : m,
          ),
        );
      },
      () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMessageId ? { ...m, isStreaming: false } : m,
          ),
        );
        setIsLoading(false);
      },
      (errMsg) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMessageId
              ? { ...m, content: errMsg, isStreaming: false }
              : m,
          ),
        );
        setIsLoading(false);
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file.name);
    }
  };

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-gray-900 text-white rounded-full shadow-lg hover:bg-gray-800 transition-all flex items-center justify-center z-50 cursor-pointer hover:scale-105"
          aria-label="Open chat"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-6 right-6 w-96 h-[520px] bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gray-900 text-white rounded-full flex items-center justify-center">
                <MessageCircle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 text-sm">
                  Q&A Assistant
                </h3>
                <p className="text-xs text-gray-500">
                  Ask questions or upload a plan
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
              aria-label="Close chat"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.type === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div className="max-w-[80%]">
                  <div
                    className={`rounded-lg px-3 py-2 text-sm ${
                      message.type === 'user'
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    {message.attachment && (
                      <div
                        className={`flex items-center gap-1.5 text-xs mb-1.5 pb-1.5 border-b ${
                          message.type === 'user'
                            ? 'border-gray-700 text-gray-300'
                            : 'border-gray-300 text-gray-500'
                        }`}
                      >
                        <Paperclip className="w-3 h-3" />
                        {message.attachment}
                      </div>
                    )}
                    {message.content || (message.isStreaming && (
                      <span className="inline-flex items-center gap-1.5 text-gray-400">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Searching knowledge base...
                      </span>
                    ))}
                  </div>
                  {message.sources && message.sources.length > 0 && (
                    <SourceList sources={message.sources} />
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {uploadedFile && (
            <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-gray-600">
                <Paperclip className="w-3 h-3" />
                {uploadedFile}
              </div>
              <button
                onClick={() => setUploadedFile(null)}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="border-t border-gray-200 p-3 flex-shrink-0">
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".txt,.md,.pdf,.doc,.docx"
                onChange={handleFileUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-2 py-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
                title="Upload a plan"
                aria-label="Upload a plan"
              >
                <Upload className="w-4 h-4" />
              </button>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question..."
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                disabled={isLoading}
              />
              <button
                onClick={handleSendMessage}
                disabled={(!inputValue.trim() && !uploadedFile) || isLoading}
                className="px-3 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                aria-label="Send message"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SourceList({ sources }: { sources: SourceDoc[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const uniqueSources = sources.filter(
    (s, i, arr) => arr.findIndex((d) => d.title === s.title) === i,
  );

  if (uniqueSources.length === 0) return null;

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
      >
        {isExpanded ? (
          <ChevronUp className="w-3 h-3" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
        {uniqueSources.length} source{uniqueSources.length !== 1 ? 's' : ''}
      </button>
      {isExpanded && (
        <div className="mt-1 space-y-1">
          {uniqueSources.map((src, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 text-xs text-gray-500 pl-1"
            >
              <span className="text-gray-300 mt-px flex-shrink-0">&bull;</span>
              <span className="leading-relaxed">
                {src.title}
                {src.contentTypeLabel && (
                  <span className="text-gray-400"> &middot; {src.contentTypeLabel}</span>
                )}
                {src.sourceUrl && (
                  <a
                    href={src.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-gray-600 hover:text-gray-900 ml-1"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
