import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  MapPin,
  Clock,
  Users,
  Target,
  Edit3,
  Download,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import type { CaseStudy } from '../data/caseStudies';

type AdaptStep = 'info' | 'context' | 'constraints' | 'output';

type SourceDoc = {
  title: string;
  sourceUrl: string;
  contentTypeLabel: string | null;
};

export function CaseStudyDetail() {
  const { caseStudyId } = useParams();
  const [caseStudy, setCaseStudy] = useState<CaseStudy | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [adaptStep, setAdaptStep] = useState<AdaptStep>('info');
  const [adaptContext, setAdaptContext] = useState('');
  const [adaptConstraints, setAdaptConstraints] = useState('');
  const [adaptedPlan, setAdaptedPlan] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editablePlan, setEditablePlan] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [showFullContent, setShowFullContent] = useState(false);

  useEffect(() => {
    if (!caseStudyId) return;
    setLoading(true);
    setFetchError(null);

    fetch(`/.netlify/functions/case-studies?id=${encodeURIComponent(caseStudyId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Not found (${res.status})`);
        return res.json();
      })
      .then((data: CaseStudy) => setCaseStudy(data))
      .catch((err) => {
        console.error('Failed to fetch case study:', err);
        setFetchError(err.message || 'Failed to load case study.');
      })
      .finally(() => setLoading(false));
  }, [caseStudyId]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Link
          to="/case-studies"
          className="inline-flex items-center gap-2 text-gray-700 hover:text-gray-900 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Case Studies
        </Link>
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          <p className="text-gray-500 font-medium">Loading case study…</p>
        </div>
      </div>
    );
  }

  if (fetchError || !caseStudy) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-gray-600">
          {fetchError || 'Case study not found.'}
        </p>
        <Link to="/case-studies" className="text-gray-900 underline">
          Back to Case Studies
        </Link>
      </div>
    );
  }

  const steps: AdaptStep[] = ['info', 'context', 'constraints', 'output'];
  const currentIdx = steps.indexOf(adaptStep);
  const progressPct = Math.round(((currentIdx + 1) / steps.length) * 100);

  const handleGeneratePlan = async () => {
    setAdaptStep('output');
    setIsGenerating(true);
    setAdaptedPlan('');
    setEditablePlan('');
    setSources([]);

    try {
      const res = await fetch('/.netlify/functions/adapt-case-study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseStudy: {
            title: caseStudy.title,
            location: caseStudy.location,
            timeframe: caseStudy.timeframe,
            size: caseStudy.scale,
            demographic: caseStudy.demographic,
            tags: caseStudy.tags,
            description: caseStudy.summary,
            keyOutcomes: caseStudy.keyOutcomes,
            implementationSteps: caseStudy.implementationSteps,
          },
          context: adaptContext,
          constraints: adaptConstraints,
        }),
      });

      if (!res.ok) throw new Error('API request failed');

      const text = await res.text();
      const lines = text.split('\n');
      let planContent = '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;

        try {
          const parsed = JSON.parse(data);
          if (parsed.content) planContent += parsed.content;
          if (parsed.sources) setSources(parsed.sources);
        } catch {
          /* skip malformed */
        }
      }

      setAdaptedPlan(planContent);
      setEditablePlan(planContent);
    } catch (err) {
      console.error('Agentic adaptation failed, using fallback:', err);
      const fallback = generateAdaptedPlanFallback(
        caseStudy,
        adaptContext,
        adaptConstraints,
      );
      setAdaptedPlan(fallback);
      setEditablePlan(fallback);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    const content = editablePlan || adaptedPlan;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `adapted-plan-${caseStudy.title
      .toLowerCase()
      .replace(/\s+/g, '-')
      .slice(0, 30)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Link
        to="/case-studies"
        className="inline-flex items-center gap-2 text-gray-700 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Case Studies
      </Link>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2">
          {/* Case Study Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-semibold text-gray-900 mb-3">
              {caseStudy.title}
            </h1>
            <div className="flex flex-wrap gap-2 mb-4">
              {caseStudy.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Location</p>
                  <p className="text-sm text-gray-900">
                    {caseStudy.location}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Timeframe</p>
                  <p className="text-sm text-gray-900">
                    {caseStudy.timeframe}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Users className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Demographic</p>
                  <p className="text-sm text-gray-900">
                    {caseStudy.demographic}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Target className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Scale</p>
                  <p className="text-sm text-gray-900 capitalize">
                    {caseStudy.scale}
                  </p>
                </div>
              </div>
            </div>
            <p className="text-gray-600">{caseStudy.summary}</p>

            {caseStudy.sourceUrl && (
              <a
                href={caseStudy.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mt-3 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View original source
              </a>
            )}
          </div>

          {/* Full Case Study Content */}
          {caseStudy.fullContent && (
            <div className="mb-8 border border-gray-200 rounded-lg bg-white">
              <button
                onClick={() => setShowFullContent(!showFullContent)}
                className="w-full flex items-center justify-between p-4 text-left cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <h3 className="font-semibold text-gray-900">
                  Full Case Study Content
                </h3>
                {showFullContent ? (
                  <ChevronUp className="w-5 h-5 text-gray-500" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-500" />
                )}
              </button>
              {showFullContent && (
                <div className="px-4 pb-4">
                  <div className="prose prose-sm max-w-none p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <SimpleMarkdownRenderer text={caseStudy.fullContent} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Adapt to My Situation Flow */}
          <div className="border border-gray-200 rounded-lg bg-white shadow-sm">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900 mb-1">
                Adapt to My Situation
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Generate a modified plan based on this case study's approach
              </p>
              <Progress value={progressPct} />
            </div>

            <div className="p-6">
              {/* Step: Info */}
              {adaptStep === 'info' && (
                <div className="space-y-4">
                  <p className="text-gray-700">
                    This tool will ask you a few quick questions about your
                    situation and generate a modified engagement plan modeled
                    on the <strong>{caseStudy.title}</strong> approach.
                  </p>
                  <p className="text-sm text-gray-500">
                    Our AI will search the knowledge base for relevant evidence
                    to ground every recommendation in your adapted plan.
                  </p>
                  <Button
                    onClick={() => setAdaptStep('context')}
                    className="mt-2"
                  >
                    Get Started
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              )}

              {/* Step: Context */}
              {adaptStep === 'context' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      Describe your situation
                    </h3>
                    <p className="text-sm text-gray-600">
                      What is your engagement about? Who are you trying to
                      reach?
                    </p>
                  </div>
                  <textarea
                    className="w-full min-h-[120px] p-4 border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-y"
                    placeholder="e.g., We're a city agency looking to gather community input on a new parks plan targeting underserved neighborhoods..."
                    value={adaptContext}
                    onChange={(e) => setAdaptContext(e.target.value)}
                  />
                  <div className="flex justify-between">
                    <button
                      onClick={() => setAdaptStep('info')}
                      className="text-gray-600 hover:text-gray-900 transition-colors cursor-pointer"
                    >
                      Back
                    </button>
                    <Button
                      onClick={() => setAdaptStep('constraints')}
                      disabled={!adaptContext.trim()}
                    >
                      Continue
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step: Constraints */}
              {adaptStep === 'constraints' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      What are your constraints?
                    </h3>
                    <p className="text-sm text-gray-600">
                      Any limitations on budget, time, staff, technology, or
                      reach?
                    </p>
                  </div>
                  <textarea
                    className="w-full min-h-[120px] p-4 border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-y"
                    placeholder="e.g., Limited budget of $3,000, 2-month timeline, small team of 2, no existing online platform..."
                    value={adaptConstraints}
                    onChange={(e) => setAdaptConstraints(e.target.value)}
                  />
                  <div className="flex justify-between">
                    <button
                      onClick={() => setAdaptStep('context')}
                      className="text-gray-600 hover:text-gray-900 transition-colors cursor-pointer"
                    >
                      Back
                    </button>
                    <Button
                      onClick={handleGeneratePlan}
                      disabled={!adaptConstraints.trim()}
                    >
                      Generate Adapted Plan
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step: Output */}
              {adaptStep === 'output' && (
                <div className="space-y-4">
                  {isGenerating ? (
                    <div className="flex flex-col items-center justify-center py-16 space-y-4">
                      <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
                      <p className="text-gray-600 font-medium">
                        Researching and adapting the case study...
                      </p>
                      <p className="text-sm text-gray-400">
                        Our AI is searching the knowledge base for relevant
                        evidence
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-gray-900">
                          Your Adapted Plan
                        </h3>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsEditing(!isEditing)}
                          >
                            <Edit3 className="w-4 h-4" />
                            {isEditing ? 'Preview' : 'Edit'}
                          </Button>
                          <Button size="sm" onClick={handleDownload}>
                            <Download className="w-4 h-4" />
                            Download
                          </Button>
                        </div>
                      </div>

                      {isEditing ? (
                        <textarea
                          className="w-full min-h-[350px] p-4 border border-gray-200 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-y"
                          value={editablePlan}
                          onChange={(e) => setEditablePlan(e.target.value)}
                        />
                      ) : (
                        <div className="prose prose-sm max-w-none p-4 bg-gray-50 rounded-lg border border-gray-200">
                          <SimpleMarkdownRenderer
                            text={editablePlan || adaptedPlan}
                          />
                        </div>
                      )}

                      {sources.length > 0 && (
                        <SourceList sources={sources} />
                      )}

                      <p className="text-xs text-gray-500 italic">
                        This adapted plan is a starting point. Edit it freely to
                        better match your specific context. For a more
                        comprehensive plan, try the{' '}
                        <Link
                          to="/coach"
                          className="text-gray-900 underline"
                        >
                          full coaching flow
                        </Link>
                        .
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar - Case Study Reference */}
        <div className="lg:col-span-1">
          <div className="sticky top-6 border border-gray-200 rounded-lg p-6 bg-gray-50">
            <h3 className="font-semibold text-gray-900 mb-3">
              Reference Case Study
            </h3>
            <h4 className="text-sm font-medium text-gray-900 mb-4">
              {caseStudy.title}
            </h4>

            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs text-gray-500 mb-1">Key Outcomes</p>
                <ul className="space-y-1">
                  {caseStudy.keyOutcomes.slice(0, 3).map((outcome, index) => (
                    <li key={index} className="text-gray-700 flex gap-2">
                      <span className="text-gray-400 flex-shrink-0">
                        &bull;
                      </span>
                      <span>{outcome}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-1">
                  Implementation Steps
                </p>
                <ol className="space-y-1">
                  {caseStudy.implementationSteps
                    .slice(0, 3)
                    .map((step, index) => (
                      <li key={index} className="text-gray-700 flex gap-2">
                        <span className="text-gray-400 flex-shrink-0">
                          {index + 1}.
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                </ol>
              </div>

              <Link
                to="/case-studies"
                className="inline-block text-gray-900 underline hover:no-underline text-sm"
              >
                View all case studies
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SimpleMarkdownRenderer({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        if (line.startsWith('## '))
          return (
            <h2
              key={i}
              className="text-lg font-semibold text-gray-900 mt-3 mb-2"
            >
              {line.replace('## ', '')}
            </h2>
          );
        if (line.startsWith('### '))
          return (
            <h3
              key={i}
              className="text-base font-semibold text-gray-900 mt-4 mb-2"
            >
              {line.replace('### ', '')}
            </h3>
          );
        if (line.startsWith('**'))
          return (
            <p key={i} className="text-gray-700 mb-1 text-sm">
              <strong>
                {line.match(/\*\*(.*?)\*\*/)?.[1] || ''}
              </strong>
              {line.replace(/\*\*.*?\*\*/, '')}
            </p>
          );
        if (line.startsWith('- '))
          return (
            <div
              key={i}
              className="flex gap-2 text-gray-700 mb-1 ml-4 text-sm"
            >
              <span className="text-gray-400 flex-shrink-0">&bull;</span>
              <span>{line.replace('- ', '')}</span>
            </div>
          );
        if (line.trim() === '') return <div key={i} className="h-2" />;
        return (
          <p key={i} className="text-gray-700 mb-1 text-sm">
            {line}
          </p>
        );
      })}
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
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors cursor-pointer w-full"
      >
        {isExpanded ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
        {uniqueSources.length} source
        {uniqueSources.length !== 1 ? 's' : ''} referenced
      </button>
      {isExpanded && (
        <div className="mt-3 space-y-2">
          {uniqueSources.map((src, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-sm text-gray-600"
            >
              <span className="text-gray-400 mt-px flex-shrink-0">&bull;</span>
              <span>
                {src.title}
                {src.contentTypeLabel && (
                  <span className="text-gray-400">
                    {' '}
                    &middot; {src.contentTypeLabel}
                  </span>
                )}
                {src.sourceUrl && (
                  <a
                    href={src.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-gray-600 hover:text-gray-900 ml-1"
                  >
                    <ExternalLink className="w-3 h-3" />
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

function generateAdaptedPlanFallback(
  caseStudy: CaseStudy,
  context: string,
  constraints: string,
): string {
  let plan = '';
  plan += `## Adapted Plan: Based on ${caseStudy.title}\n\n`;
  plan += `**Your Context:** ${context}\n`;
  plan += `**Your Constraints:** ${constraints}\n`;
  plan += `**Reference Case Study:** ${caseStudy.title} (${caseStudy.location})\n\n`;
  plan += `### Adapted Approach\n\n`;
  plan += `Drawing from the ${caseStudy.title} model, here is a plan adapted to your situation:\n\n`;

  plan += `### Phase 1: Setup (Adapted from ${caseStudy.location} approach)\n\n`;
  caseStudy.implementationSteps.slice(0, 2).forEach((step) => {
    plan += `- ${step}\n`;
  });
  plan += `- Adapt these steps to your specific context: ${context.slice(0, 80)}...\n`;

  plan += `\n### Phase 2: Implementation\n\n`;
  caseStudy.implementationSteps.slice(2).forEach((step) => {
    plan += `- ${step}\n`;
  });

  const constraintsLower = constraints.toLowerCase();
  if (
    constraintsLower.includes('budget') ||
    constraintsLower.includes('limited') ||
    constraintsLower.includes('resource')
  ) {
    plan += `- Focus on low-cost, high-impact activities first\n`;
    plan += `- Leverage volunteer networks and existing community infrastructure\n`;
  }

  plan += `\n### Phase 3: Evaluation & Outcomes\n\n`;
  plan += `Target outcomes modeled on the original case study:\n`;
  caseStudy.keyOutcomes.forEach((outcome) => {
    plan += `- ${outcome}\n`;
  });

  plan += `\n### Key Adaptations for Your Context\n\n`;
  plan += `- Modified for your constraints: ${constraints}\n`;
  plan += `- Timeline and scale adjusted based on your situation\n`;
  plan += `- Core principles preserved from the ${caseStudy.title} model\n`;

  return plan;
}
