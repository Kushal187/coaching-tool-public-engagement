import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Filter,
  MapPin,
  Clock,
  Users,
  Target,
  ArrowRight,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from './ui/badge';
import { API } from '../api-config';
import type { CaseStudy } from '../data/caseStudies';

const TOPIC_CATEGORIES: { label: string; keywords: string[] }[] = [
  {
    label: 'Governance & Democracy',
    keywords: [
      'governance', 'democracy', 'deliberative', 'participatory governance',
      'constitutional', 'electoral', 'referendum', 'citizen assembly',
      'citizens\' assembly', 'legislative', 'parliament', 'voting',
      'sortition', 'mini-public', 'citizen panel', 'citizens\' jury',
      'citizen jury', 'open government', 'accountability', 'transparency',
      'decentralization', 'devolution',
    ],
  },
  {
    label: 'Budgeting & Public Finance',
    keywords: [
      'budget', 'fiscal', 'public finance', 'tax', 'revenue',
      'financial management', 'resource allocation', 'funding',
    ],
  },
  {
    label: 'Urban Planning & Housing',
    keywords: [
      'urban planning', 'urban development', 'housing', 'urban regeneration',
      'land use', 'zoning', 'placemaking', 'urban renewal', 'urban design',
      'urban redevelopment', 'smart city', 'smart cities', 'urban infrastructure',
      'neighborhood', 'neighbourhood', 'informal settlement', 'slum',
    ],
  },
  {
    label: 'Climate & Environment',
    keywords: [
      'climate', 'environment', 'sustainability', 'biodiversity', 'conservation',
      'energy', 'renewable', 'carbon', 'pollution', 'waste', 'water',
      'ecological', 'green', 'air quality', 'deforestation', 'ecosystem',
      'circular economy', 'net zero', 'decarbonization',
    ],
  },
  {
    label: 'Health & Public Health',
    keywords: [
      'health', 'covid', 'pandemic', 'mental health', 'wellbeing', 'well-being',
      'healthcare', 'medical', 'disease', 'patient', 'hospital', 'vaccine',
      'sanitation', 'hygiene', 'nutrition', 'hiv', 'aids', 'drug policy',
      'opioid', 'substance',
    ],
  },
  {
    label: 'Education',
    keywords: [
      'education', 'school', 'curriculum', 'higher education', 'civic education',
      'learning', 'university', 'student', 'teacher', 'literacy',
    ],
  },
  {
    label: 'Youth Engagement',
    keywords: [
      'youth', 'child', 'young people', 'intergenerational', 'adolescent',
      'juvenile', 'early childhood',
    ],
  },
  {
    label: 'Technology & Digital',
    keywords: [
      'digital', 'technology', 'online', 'e-participation', 'eparticipation',
      'e-democracy', 'edemocracy', 'civic tech', 'artificial intelligence', 'ai ',
      'blockchain', 'open data', 'crowdsourcing', 'hackathon', 'data',
      'internet', 'mobile', 'platform', 'ict', 'cyber',
    ],
  },
  {
    label: 'Social Justice & Equity',
    keywords: [
      'justice', 'equity', 'gender', 'indigenous', 'human rights', 'racial',
      'lgbtq', 'disability', 'inclusion', 'diversity', 'feminism', 'feminist',
      'women', 'minority', 'discrimination', 'civil rights', 'immigrant',
      'refugee', 'migration', 'decolonization',
    ],
  },
  {
    label: 'Infrastructure & Transportation',
    keywords: [
      'transport', 'infrastructure', 'mobility', 'road', 'transit', 'cycling',
      'pedestrian', 'traffic', 'railway', 'airport', 'port', 'highway',
      'bicycle', 'public transit',
    ],
  },
  {
    label: 'Community Development',
    keywords: [
      'community development', 'rural development', 'economic development',
      'capacity building', 'microfinance', 'cooperative', 'community empowerment',
      'community organizing', 'community mobilization', 'local development',
      'regional development', 'poverty', 'livelihood', 'economic empowerment',
    ],
  },
  {
    label: 'Peace & Reconciliation',
    keywords: [
      'peace', 'conflict', 'reconciliation', 'truth commission',
      'post-conflict', 'restorative justice', 'violence prevention',
      'transitional justice', 'peacebuilding', 'mediation', 'ceasefire',
      'war', 'crisis response', 'disaster', 'emergency',
    ],
  },
];

function matchesCategory(tags: string[], keywords: string[]): boolean {
  return tags.some((tag) => {
    const lower = tag.toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
  });
}

export function CaseStudies() {
  const [caseStudies, setCaseStudies] = useState<CaseStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');

  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const allStudiesRef = useRef<CaseStudy[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const fetchCaseStudies = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API.caseStudies.url);
      if (!res.ok) throw new Error(`Failed to load case studies (${res.status})`);
      const data: CaseStudy[] = await res.json();
      allStudiesRef.current = data;
      setCaseStudies(data);
    } catch (err) {
      console.error('Failed to fetch case studies:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to load case studies.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCaseStudies();
  }, []);

  const executeSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSearching(true);
    setActiveQuery(query.trim());

    try {
      const res = await fetch(
        `${API.caseStudies.url}?q=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal },
      );
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data: CaseStudy[] = await res.json();
      console.log(`[search] q="${query}" → ${data.length} results, top 3:`, data.slice(0, 3).map(d => d.title));
      if (!controller.signal.aborted) {
        setCaseStudies(data);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Search failed:', err);
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Search failed.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setSearching(false);
      }
    }
  }, []);

  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    setSearchInput('');
    setActiveQuery('');
    setSearching(false);
    setCaseStudies(allStudiesRef.current);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        executeSearch(searchInput);
      }
    },
    [executeSearch, searchInput],
  );

  const sizes = ['all', 'small', 'medium', 'large'];

  const filteredCaseStudies = caseStudies.filter((study) => {
    const sizeMatch =
      selectedSize === 'all' || study.scale === selectedSize;
    const tagMatch =
      selectedTag === 'all' ||
      matchesCategory(
        study.tags,
        TOPIC_CATEGORIES.find((c) => c.label === selectedTag)?.keywords ?? [],
      );
    return sizeMatch && tagMatch;
  });

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1
          className="text-3xl text-[#124D8F] mb-2"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Case Study Library
        </h1>
        <p className="text-gray-600">
          Explore real-world examples of successful public engagement
          initiatives.
        </p>
      </div>

      {!loading && !error && (
        <div className="mb-6 flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search case studies by keyword or topic…"
              className="w-full pl-10 pr-9 py-2.5 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#124D8F] focus:border-transparent bg-white text-sm"
            />
            {searchInput && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => executeSearch(searchInput)}
            disabled={searching || !searchInput.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#124D8F] text-white text-sm font-medium rounded-md hover:bg-[#0e3d72] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {searching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Search
          </button>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-8 h-8 text-[#124D8F] animate-spin" />
          <p className="text-gray-500 font-medium">Loading case studies...</p>
        </div>
      )}

      {error && !loading && (
        <div className="text-center py-16 space-y-4">
          <p className="text-gray-600">{error}</p>
          <button
            onClick={fetchCaseStudies}
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-[#E4EFFC] transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="mb-8 p-6 bg-[#E4EFFC]/40 border border-[#124D8F]/10 rounded-lg">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="w-5 h-5 text-[#124D8F]" />
              <span className="font-medium text-[#124D8F]">
                Filter Case Studies
              </span>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Scale
                </label>
                <select
                  value={selectedSize}
                  onChange={(e) => setSelectedSize(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#124D8F] focus:border-transparent bg-white cursor-pointer"
                >
                  <option value="all">All Scales</option>
                  {sizes
                    .filter((s) => s !== 'all')
                    .map((size) => (
                      <option key={size} value={size}>
                        {size.charAt(0).toUpperCase() + size.slice(1)} Scale
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Topic
                </label>
                <select
                  value={selectedTag}
                  onChange={(e) => setSelectedTag(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#124D8F] focus:border-transparent bg-white cursor-pointer"
                >
                  <option value="all">All Topics</option>
                  {TOPIC_CATEGORIES.map((cat) => (
                    <option key={cat.label} value={cat.label}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {filteredCaseStudies.map((study) => (
              <div
                key={study.id}
                className="border border-gray-200 rounded-lg p-6 bg-white hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3
                    className="text-xl text-[#124D8F]"
                    style={{ fontFamily: "'DM Serif Display', serif" }}
                  >
                    {study.title}
                  </h3>
                  <Link
                    to={`/case-studies/${study.id}`}
                    className="flex items-center gap-2 px-4 py-2 bg-[#124D8F] text-white text-sm rounded-md hover:bg-[#0e3d72] transition-colors flex-shrink-0 ml-4"
                  >
                    View Details
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-[#124D8F] mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Location</p>
                      <p className="text-sm text-gray-900">{study.location}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Clock className="w-4 h-4 text-[#124D8F] mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Timeframe</p>
                      <p className="text-sm text-gray-900">
                        {study.timeframe}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Users className="w-4 h-4 text-[#124D8F] mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Demographic</p>
                      <p className="text-sm text-gray-900">
                        {study.demographic}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Target className="w-4 h-4 text-[#124D8F] mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500">Scale</p>
                      <p className="text-sm text-gray-900 capitalize">
                        {study.scale}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  {study.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>

                <p className="text-gray-600 mb-4">{study.summary}</p>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium text-[#124D8F] mb-2">
                      Key Outcomes
                    </h4>
                    <ul className="space-y-1">
                      {study.keyOutcomes.map((outcome, index) => (
                        <li
                          key={index}
                          className="text-sm text-gray-600 flex gap-2"
                        >
                          <span className="text-[#FDCE3E] flex-shrink-0">
                            &bull;
                          </span>
                          <span>{outcome}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium text-[#124D8F] mb-2">
                      Implementation Steps
                    </h4>
                    <ol className="space-y-1">
                      {study.implementationSteps.map((step, index) => (
                        <li
                          key={index}
                          className="text-sm text-gray-600 flex gap-2"
                        >
                          <span className="text-[#124D8F] flex-shrink-0">
                            {index + 1}.
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredCaseStudies.length === 0 && activeQuery && (
            <div className="text-center py-12">
              <p className="text-gray-500">
                No case studies found for '{activeQuery}'. Try a different search term.
              </p>
            </div>
          )}

          {filteredCaseStudies.length === 0 && !activeQuery && caseStudies.length > 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500">
                No case studies match your selected filters. Try adjusting your
                criteria.
              </p>
            </div>
          )}

          {caseStudies.length === 0 && !activeQuery && (
            <div className="text-center py-12">
              <p className="text-gray-500">
                No case studies are available yet. Run the ingestion pipeline to
                populate the library.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
