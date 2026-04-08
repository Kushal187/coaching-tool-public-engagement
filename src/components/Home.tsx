import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowRight,
  Loader2,
  MessageSquareText,
  BookOpen,
  FileText,
  ChevronDown,
} from 'lucide-react';

export function Home() {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [isNavigating, setIsNavigating] = useState(false);

  const handleSubmit = () => {
    const text = inputValue.trim();
    if (!text || isNavigating) return;
    setIsNavigating(true);
    navigate('/coach', { state: { initialMessage: text } });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="bg-white">
      {/* Hero + Chat Input — centered in viewport */}
      <section className="min-h-[calc(100vh-73px)] flex flex-col items-center justify-center px-6">
        <div className="max-w-3xl w-full text-center">
          <h1
            className="text-5xl text-[#124D8F] mb-4"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Public Engagement Coach
          </h1>
          <p className="text-lg text-gray-600 max-w-xl mx-auto mb-10">
            Plan better public engagement projects with guidance grounded in
            real evidence and case studies.
          </p>

          <div className="relative">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What public engagement challenge can I help you with today?"
              rows={5}
              className="w-full px-6 py-5 text-lg border border-gray-200 rounded-[20px] resize-none focus:outline-none focus:ring-2 focus:ring-[#124D8F] focus:border-transparent leading-relaxed shadow-[4px_4px_7px_rgba(18,77,143,0.14)]"
              disabled={isNavigating}
            />
            <button
              onClick={handleSubmit}
              disabled={!inputValue.trim() || isNavigating}
              className="absolute bottom-4 right-4 px-5 py-2.5 bg-[#124D8F] text-white rounded-full hover:bg-[#0e3d72] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2 text-base font-medium"
            >
              {isNavigating ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Get started
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Scroll indicator */}
        <button
          onClick={() =>
            document
              .getElementById('learn-more')
              ?.scrollIntoView({ behavior: 'smooth' })
          }
          className="mt-10 flex flex-col items-center gap-1 text-gray-400 hover:text-[#124D8F] transition-colors cursor-pointer"
        >
          <span className="text-sm">Learn more</span>
          <ChevronDown className="w-5 h-5 animate-bounce" />
        </button>
      </section>

      {/* What is this */}
      <section id="learn-more" className="px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <div className="bg-[#f7fafd] border border-[#d1dce8] rounded-[20px] p-8">
            <h2
              className="text-2xl text-[#124D8F] mb-4"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              What is this?
            </h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              This is a coaching tool that helps you think through your public
              engagement project before you launch it. It walks you through the
              key questions you should be asking – things like who your audience
              is, what methods to use, how to handle feedback, and what success
              looks like – using the GovLab framework on public engagement as a
              guide.
            </p>
            <p className="text-gray-700 leading-relaxed">
              It's not a general-purpose chatbot. It's narrowly focused on one
              thing: helping you design a stronger public engagement process.
            </p>
          </div>
        </div>
      </section>

      {/* Three Features */}
      <section className="px-6 pb-16">
        <div className="max-w-3xl mx-auto">
          <h2
            className="text-2xl text-[#124D8F] mb-2 text-center"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            What does it do?
          </h2>
          <p className="text-gray-500 text-center mb-8">Three things:</p>

          <div className="grid gap-6 md:grid-cols-3">
            {/* Feature 1 */}
            <div className="border border-gray-200 rounded-[20px] p-6 hover:shadow-[4px_8px_15px_rgba(18,77,143,0.15)] transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-[#E4EFFC] flex items-center justify-center mb-4">
                <MessageSquareText className="w-5 h-5 text-[#124D8F]" />
              </div>
              <h3 className="font-semibold text-[#124D8F] mb-2">
                Guided Coaching Conversation
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                You describe your engagement challenge, and the tool coaches you
                through 9 key planning questions. It asks follow-ups, pushes you
                to think deeper, and pulls in real examples from a curated
                knowledge base of case studies and best practices.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="border border-gray-200 rounded-[20px] p-6 hover:shadow-[4px_8px_15px_rgba(18,77,143,0.15)] transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-[#E4EFFC] flex items-center justify-center mb-4">
                <BookOpen className="w-5 h-5 text-[#124D8F]" />
              </div>
              <h3 className="font-semibold text-[#124D8F] mb-2">
                Case Study Library
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                Browse real-world public engagement examples – governance,
                climate, health, education, urban planning, and more. You can
                search these during coaching or on your own.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="border border-gray-200 rounded-[20px] p-6 hover:shadow-[4px_8px_15px_rgba(18,77,143,0.15)] transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-[#E4EFFC] flex items-center justify-center mb-4">
                <FileText className="w-5 h-5 text-[#124D8F]" />
              </div>
              <h3 className="font-semibold text-[#124D8F] mb-2">
                Personalized Reflection Report
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                When you're done, you get a downloadable PDF that summarizes
                where you stand. It shows what you've figured out, what still
                needs work, and gives you a short list of priority actions with
                timelines.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What do you get */}
      <section className="px-6 pb-20">
        <div className="max-w-3xl mx-auto">
          <div className="bg-[#124D8F] text-white rounded-[20px] p-8">
            <h2
              className="text-2xl mb-4"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              What do you get at the end?
            </h2>
            <p className="text-blue-100 leading-relaxed mb-5">
              A reflection document (PDF) tailored to your project. It includes:
            </p>
            <ul className="space-y-3 mb-6">
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-2 h-2 rounded-full bg-[#F9C011] shrink-0" />
                <span className="text-blue-50">
                  An honest assessment of your readiness
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-2 h-2 rounded-full bg-[#F9C011] shrink-0" />
                <span className="text-blue-50">
                  Your strengths and gaps against the framework
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-2 h-2 rounded-full bg-[#F9C011] shrink-0" />
                <span className="text-blue-50">
                  3–5 concrete next steps you can actually act on
                </span>
              </li>
            </ul>
            <p className="text-blue-100 leading-relaxed">
              You walk away with a clear picture of what's solid in your plan
              and what needs more thought.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
