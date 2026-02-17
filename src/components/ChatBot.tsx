import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Upload, Paperclip } from 'lucide-react';

type Message = {
  id: string;
  type: 'user' | 'bot';
  content: string;
  attachment?: string;
};

function generateResponse(question: string, hasUpload: boolean): string {
  const lq = question.toLowerCase();

  if (hasUpload) {
    return "Thanks for uploading your plan! I can see the document you've shared. What specific part of your plan would you like help with? I can provide guidance on any step you're stuck on. (Backend not connected yet — this is a placeholder response.)";
  }

  if (lq.includes('stakeholder') || lq.includes('mapping')) {
    return 'Stakeholder mapping involves identifying all individuals, groups, and organizations that may affect or be affected by your engagement. Start by listing all potential stakeholders, then assess their level of interest and influence. This helps you prioritize engagement efforts and tailor your communication strategies. Would you like specific guidance on creating a stakeholder matrix?';
  }
  if (lq.includes('engagement method') || lq.includes('tool') || lq.includes('method')) {
    return 'Choosing the right engagement methods depends on your context, audience, and objectives. Common methods include surveys, workshops, focus groups, online platforms, and town halls. Consider factors like accessibility, time constraints, and the level of participation you need (inform, consult, involve, collaborate, or empower). What type of engagement are you planning?';
  }
  if (lq.includes('evaluation') || lq.includes('metric') || lq.includes('measure')) {
    return 'Effective evaluation starts with defining clear objectives and success criteria. Use both quantitative metrics (participation rates, demographic representation) and qualitative measures (quality of input, satisfaction levels). Establish baseline data before engagement begins, and plan for regular monitoring throughout the process. What specific outcomes are you hoping to measure?';
  }
  if (lq.includes('case stud')) {
    return 'Our Case Studies library provides real-world examples of successful public engagement initiatives. Each case study includes context, key outcomes, and implementation steps. You can also use the "Adapt to My Situation" button to generate a plan based on any case study. Would you like me to recommend a specific case study?';
  }
  if (lq.includes('plan') || lq.includes('start') || lq.includes('begin')) {
    return "I recommend starting with our Coach feature, which will walk you through context-gathering questions and generate a tailored engagement plan. You can also explore our Case Studies for real-world inspiration. Would you like me to help you think through your engagement strategy?";
  }
  if (lq.includes('stuck') || lq.includes('help') || lq.includes('problem')) {
    return "I'm here to help! If you're stuck on a specific step in your plan, you can upload your plan document using the attachment button and I can provide targeted guidance. You can also describe the challenge you're facing and I'll suggest approaches based on course frameworks. What's the specific issue?";
  }
  if (lq.includes('budget') || lq.includes('resource') || lq.includes('money')) {
    return 'Working with limited resources is a common challenge. Key strategies include: leveraging existing community networks and partnerships, using free or low-cost digital tools, training volunteers as facilitators, and focusing on high-impact engagement methods. The Rural Health Service Co-Design case study from Australia is a great example of effective low-budget engagement. Want me to elaborate on any of these strategies?';
  }
  if (lq.includes('digital') || lq.includes('online') || lq.includes('virtual')) {
    return "Digital engagement tools can dramatically expand your reach. Consider platforms like online surveys (Google Forms, SurveyMonkey), deliberation tools (Pol.is, Decidim), and social media engagement. The vTaiwan initiative is an excellent example of effective digital democracy. Key considerations: accessibility, digital literacy of your audience, and ensuring meaningful participation rather than just collecting clicks. What's your target audience's digital comfort level?";
  }

  return "That's an interesting question. For detailed guidance, I recommend using the Coach feature for a personalized planning session, or browsing the Case Studies for real-world examples. You can also upload an existing plan and I can help you troubleshoot specific steps. What specific area would you like to explore? (Backend not connected yet — AI-powered responses coming soon.)";
}

export function ChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'bot',
      content:
        "Hi! I'm your public engagement assistant. I can help answer questions, provide guidance on your engagement strategy, or assist with a plan you're working on. You can also upload an existing plan for targeted help.",
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = () => {
    if (!inputValue.trim() && !uploadedFile) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: inputValue || '(Uploaded a plan document)',
      attachment: uploadedFile || undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    const hasUpload = !!uploadedFile;

    setTimeout(() => {
      const botResponse = generateResponse(inputValue, hasUpload);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          type: 'bot',
          content: botResponse,
        },
      ]);
    }, 600);

    setInputValue('');
    setUploadedFile(null);
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
      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-gray-900 text-white rounded-full shadow-lg hover:bg-gray-800 transition-all flex items-center justify-center z-50 cursor-pointer hover:scale-105"
          aria-label="Open chat"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-96 h-[520px] bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col z-50">
          {/* Header */}
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

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.type === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
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
                  {message.content}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Upload indicator */}
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

          {/* Input */}
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
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputValue.trim() && !uploadedFile}
                className="px-3 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
