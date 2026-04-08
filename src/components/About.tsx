import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import {
  ExternalLink,
  BookOpen,
  MessageSquare,
  FileText,
  Target,
  Users,
  Lightbulb,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

type Source = {
  name: string;
  url: string;
  contentType: string;
  date: string;
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
  case_study: 'Case Studies',
  transcript: 'Transcripts',
  blog_post: 'Blog Posts',
  journal_article: 'Journal Articles',
  report: 'Reports',
  guide: 'Guides',
  policy_brief: 'Policy Briefs',
  lecture: 'Lectures',
  tool_or_resource: 'Tools & Resources',
  other: 'Other',
};

const TYPE_ORDER = [
  'guide',
  'case_study',
  'report',
  'journal_article',
  'policy_brief',
  'blog_post',
  'lecture',
  'transcript',
  'tool_or_resource',
  'other',
];

function groupByType(sources: Source[]) {
  const groups: Record<string, Source[]> = {};
  for (const s of sources) {
    const type = s.contentType || 'other';
    if (!groups[type]) groups[type] = [];
    groups[type].push(s);
  }
  return TYPE_ORDER
    .filter((t) => groups[t]?.length)
    .map((t) => ({ type: t, label: CONTENT_TYPE_LABELS[t] || t, sources: groups[t] }));
}

export function About() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/sources')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      })
      .then((data) => {
        setSources(data);
        setLoading(false);
      })
      .catch(() => {
        setError('Unable to load sources.');
        setLoading(false);
      });
  }, []);

  const grouped = groupByType(sources);

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* Hero */}
      <div className="text-center mb-16">
        <h1
          className="text-4xl text-[#124D8F] mb-4"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          About This Tool
        </h1>
        <p className="text-gray-600 text-lg max-w-2xl mx-auto leading-relaxed">
          Public engagement is hard to get right. Practitioners are often expected to
          design inclusive, effective engagement processes without dedicated training or
          access to the latest research. The Public Engagement Coach closes that gap — it
          brings together evidence from leading guides, real-world case studies, and academic
          research into an AI-powered coaching experience that helps you think through your
          project step by step, so you can make better decisions before you go live.
        </p>
      </div>

      {/* What this is */}
      <section className="mb-14">
        <h2
          className="text-2xl text-[#124D8F] mb-6"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          What It Does
        </h2>
        <p className="text-gray-600 leading-relaxed mb-6">
          This tool coaches you through the{' '}
          <strong className="text-gray-900">GovLab Framework</strong> — a set of 9 questions
          that help you think through every aspect of a public engagement project, from
          setting clear goals to evaluating outcomes. Instead of generic advice, every
          response is grounded in real guides, case studies, and research from our knowledge
          base.
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="bg-[#F4F7FB] rounded-xl p-5">
            <MessageSquare className="w-5 h-5 text-[#124D8F] mb-3" />
            <h3 className="font-semibold text-gray-900 text-sm mb-1">Coaching Chat</h3>
            <p className="text-gray-500 text-sm leading-relaxed">
              A guided conversation that walks you through each question with tailored,
              evidence-backed probing.
            </p>
          </div>
          <div className="bg-[#F4F7FB] rounded-xl p-5">
            <BookOpen className="w-5 h-5 text-[#124D8F] mb-3" />
            <h3 className="font-semibold text-gray-900 text-sm mb-1">Case Study Library</h3>
            <p className="text-gray-500 text-sm leading-relaxed">
              Real-world examples of public engagement projects you can explore, filter,
              and learn from.
            </p>
          </div>
          <div className="bg-[#F4F7FB] rounded-xl p-5">
            <FileText className="w-5 h-5 text-[#124D8F] mb-3" />
            <h3 className="font-semibold text-gray-900 text-sm mb-1">Reflection Report</h3>
            <p className="text-gray-500 text-sm leading-relaxed">
              A downloadable summary of your strengths, gaps, and priority actions after
              your coaching session.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mb-14">
        <h2
          className="text-2xl text-[#124D8F] mb-6"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          How It Works
        </h2>
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="w-8 h-8 rounded-full bg-[#124D8F] text-white flex items-center justify-center flex-shrink-0 text-sm font-semibold">
              1
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Describe your challenge</h3>
              <p className="text-gray-500 text-sm leading-relaxed">
                Tell the coach what public engagement project you're working on.
              </p>
            </div>
          </div>
          <div className="flex gap-4 items-start">
            <div className="w-8 h-8 rounded-full bg-[#124D8F] text-white flex items-center justify-center flex-shrink-0 text-sm font-semibold">
              2
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Work through the framework</h3>
              <p className="text-gray-500 text-sm leading-relaxed">
                The coach guides you through the 9 GovLab questions — one at a time, at your
                pace — using evidence from our knowledge base to probe and support your thinking.
              </p>
            </div>
          </div>
          <div className="flex gap-4 items-start">
            <div className="w-8 h-8 rounded-full bg-[#124D8F] text-white flex items-center justify-center flex-shrink-0 text-sm font-semibold">
              3
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Get your reflection</h3>
              <p className="text-gray-500 text-sm leading-relaxed">
                Once you've addressed enough questions, generate a reflection report with
                strengths, gaps, and priority actions you can download as a PDF.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* The 9 Questions */}
      <section className="mb-14">
        <h2
          className="text-2xl text-[#124D8F] mb-6"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          The 9 GovLab Questions
        </h2>
        <p className="text-gray-600 leading-relaxed mb-6">
          The framework is built around these questions, drawn from GovLab's research on
          what makes public engagement effective:
        </p>
        <ol className="space-y-3">
          {[
            { icon: Target, q: "Have you articulated the project's goals?" },
            { icon: Users, q: 'Have you identified the right participants?' },
            { icon: Users, q: 'Can you reach the participants you identified?' },
            { icon: Users, q: 'Who is the right owner?' },
            { icon: Lightbulb, q: 'Have you included incentives for participation?' },
            { icon: FileText, q: 'Have you defined the tasks?' },
            { icon: FileText, q: 'Have you established the workflow?' },
            { icon: Target, q: 'How will you evaluate inputs?' },
            { icon: Target, q: 'How will you use what the group creates?' },
          ].map((item, i) => (
            <li key={i} className="flex items-center gap-3 text-gray-700">
              <span className="w-6 h-6 rounded-full bg-[#E4EFFC] text-[#124D8F] flex items-center justify-center flex-shrink-0 text-xs font-semibold">
                {i + 1}
              </span>
              {item.q}
            </li>
          ))}
        </ol>
      </section>

      {/* Knowledge Base Sources */}
      <section className="mb-14">
        <h2
          className="text-2xl text-[#124D8F] mb-3"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Our Knowledge Base
        </h2>
        <p className="text-gray-600 leading-relaxed mb-8">
          Every coaching response is grounded in a curated collection of public engagement
          resources. When you see a citation badge in the chat, it links back to one of
          these sources.
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-gray-400 py-8 justify-center">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading sources...
          </div>
        )}

        {error && (
          <p className="text-red-500 text-sm py-4">{error}</p>
        )}

        {!loading && !error && (
          <div className="space-y-2">
            {grouped.map((group) => {
              const isExpanded = expanded[group.type] ?? false;

              return (
                <div key={group.type} className="border border-gray-100 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpanded((prev) => ({ ...prev, [group.type]: !isExpanded }))}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">
                        {group.label}
                      </span>
                      <span className="text-xs text-gray-400">
                        ({group.sources.length})
                      </span>
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                  </button>

                  {isExpanded && (
                    <ul className="divide-y divide-gray-50">
                      {group.sources.map((s, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-4 px-4 py-2.5"
                        >
                          {s.url ? (
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-600 text-sm hover:text-[#124D8F] transition-colors inline-flex items-center gap-1.5"
                            >
                              {s.name}
                              <ExternalLink className="w-3 h-3 text-gray-300 flex-shrink-0" />
                            </a>
                          ) : (
                            <span className="text-gray-600 text-sm">{s.name}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {grouped.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-4">No sources available.</p>
            )}
          </div>
        )}
      </section>

      {/* CTA */}
      <div className="text-center pt-4 pb-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-6 py-3 bg-[#124D8F] text-white rounded-lg hover:bg-[#0e3d72] transition-colors font-medium"
        >
          <MessageSquare className="w-4 h-4" />
          Start Coaching
        </Link>
      </div>
    </div>
  );
}
