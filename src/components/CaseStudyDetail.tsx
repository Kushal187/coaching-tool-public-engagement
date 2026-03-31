import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router';
import {
  ArrowLeft,
  MapPin,
  Clock,
  Users,
  Target,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Badge } from './ui/badge';
import { MarkdownContent } from './ui/markdown-content';
import { API } from '../api-config';
import type { CaseStudy } from '../data/caseStudies';

export function CaseStudyDetail() {
  const { caseStudyId } = useParams();
  const [caseStudy, setCaseStudy] = useState<CaseStudy | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showFullContent, setShowFullContent] = useState(false);

  useEffect(() => {
    if (!caseStudyId) return;
    setLoading(true);
    setFetchError(null);

    fetch(`${API.caseStudies.url}?id=${encodeURIComponent(caseStudyId)}`)
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
          className="inline-flex items-center gap-2 text-[#124D8F] hover:text-[#0e3d72] mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Case Studies
        </Link>
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-8 h-8 text-[#124D8F] animate-spin" />
          <p className="text-gray-500 font-medium">Loading case study...</p>
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
        <Link to="/case-studies" className="text-[#124D8F] underline">
          Back to Case Studies
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Link
        to="/case-studies"
        className="inline-flex items-center gap-2 text-[#124D8F] hover:text-[#0e3d72] mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Case Studies
      </Link>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="mb-6">
            <h1
              className="text-3xl text-[#124D8F] mb-3"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
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
                <MapPin className="w-4 h-4 text-[#124D8F] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Location</p>
                  <p className="text-sm text-gray-900">
                    {caseStudy.location}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-[#124D8F] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Timeframe</p>
                  <p className="text-sm text-gray-900">
                    {caseStudy.timeframe}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Users className="w-4 h-4 text-[#124D8F] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Demographic</p>
                  <p className="text-sm text-gray-900">
                    {caseStudy.demographic}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Target className="w-4 h-4 text-[#124D8F] mt-0.5 flex-shrink-0" />
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
                className="inline-flex items-center gap-1 text-sm text-[#124D8F] hover:text-[#0e3d72] mt-3 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View original source
              </a>
            )}
          </div>

          {caseStudy.fullContent && (
            <div className="mb-8 border border-gray-200 rounded-lg bg-white">
              <button
                onClick={() => setShowFullContent(!showFullContent)}
                className="w-full flex items-center justify-between p-4 text-left cursor-pointer hover:bg-[#E4EFFC]/30 transition-colors"
              >
                <h3
                  className="font-semibold text-[#124D8F]"
                >
                  Full Case Study Content
                </h3>
                {showFullContent ? (
                  <ChevronUp className="w-5 h-5 text-[#124D8F]" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-[#124D8F]" />
                )}
              </button>
              {showFullContent && (
                <div className="px-4 pb-4">
                  <div className="p-4 bg-[#E4EFFC]/30 rounded-lg border border-[#124D8F]/10">
                    <MarkdownContent>{caseStudy.fullContent}</MarkdownContent>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="sticky top-6 border border-[#124D8F]/10 rounded-lg p-6 bg-[#E4EFFC]/30">
            <h3 className="font-semibold text-[#124D8F] mb-3">
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
                      <span className="text-[#FDCE3E] flex-shrink-0">
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
                        <span className="text-[#124D8F] flex-shrink-0">
                          {index + 1}.
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                </ol>
              </div>

              <Link
                to="/case-studies"
                className="inline-block text-[#124D8F] underline hover:no-underline text-sm"
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
