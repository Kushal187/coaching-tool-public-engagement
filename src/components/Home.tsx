import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Loader2 } from 'lucide-react';

export function Home() {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [isNavigating, setIsNavigating] = useState(false);

  const handleSubmit = () => {
    const text = inputValue.trim();
    if (!text || isNavigating) return;
    setIsNavigating(true);
    // Pass the initial message to the coach via URL state
    navigate('/coach', { state: { initialMessage: text } });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-73px-200px)] px-6">
      <div className="max-w-2xl w-full text-center">
        <h1
          className="text-4xl text-[#124D8F] mb-3"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Public Engagement Coach
        </h1>
        <p className="text-gray-500 mb-10">
          Get practical, evidence-based guidance for your public engagement projects.
        </p>

        <div className="relative">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What public engagement challenge can I help you with today?"
            rows={3}
            className="w-full px-5 py-4 text-base border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#124D8F] focus:border-transparent leading-relaxed shadow-sm"
            disabled={isNavigating}
          />
          <button
            onClick={handleSubmit}
            disabled={!inputValue.trim() || isNavigating}
            className="absolute bottom-3 right-3 px-4 py-2 bg-[#124D8F] text-white rounded-lg hover:bg-[#0e3d72] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2 text-sm font-medium"
          >
            {isNavigating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Get started
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>

        <p className="text-xs text-gray-400 mt-4">
          Powered by a curated knowledge base of public engagement guides, case studies, and best practices.
        </p>
      </div>
    </div>
  );
}
