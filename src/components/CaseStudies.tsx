import { useState } from 'react';
import { Filter, MapPin, Clock, Users, Target, ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from './ui/badge';
import { caseStudies } from '../data/caseStudies';

export function CaseStudies() {
  const [selectedSize, setSelectedSize] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');

  const allTags = Array.from(
    new Set(caseStudies.flatMap((cs) => cs.tags))
  ).sort();

  const sizes = ['all', 'small', 'medium', 'large'];

  const filteredCaseStudies = caseStudies.filter((study) => {
    const sizeMatch =
      selectedSize === 'all' || study.sizeCategory === selectedSize;
    const tagMatch =
      selectedTag === 'all' || study.tags.includes(selectedTag);
    return sizeMatch && tagMatch;
  });

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">
          Case Study Library
        </h1>
        <p className="text-gray-600">
          Explore real-world examples of successful public engagement
          initiatives. Use "Adapt to My Situation" to generate a plan modeled
          on any case study.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-8 p-6 bg-gray-50 border border-gray-200 rounded-lg">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-gray-700" />
          <span className="font-medium text-gray-900">
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
              className="w-full px-4 py-2 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent bg-white cursor-pointer"
            >
              <option value="all">All Sizes</option>
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
              className="w-full px-4 py-2 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent bg-white cursor-pointer"
            >
              <option value="all">All Topics</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Case Study List */}
      <div className="space-y-6">
        {filteredCaseStudies.map((study) => (
          <div
            key={study.id}
            className="border border-gray-200 rounded-lg p-6 bg-white hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-xl font-semibold text-gray-900">
                {study.title}
              </h3>
              <Link
                to={`/case-studies/${study.id}`}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800 transition-colors flex-shrink-0 ml-4"
              >
                Adapt to My Situation
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Location</p>
                  <p className="text-sm text-gray-900">{study.location}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Timeframe</p>
                  <p className="text-sm text-gray-900">{study.timeframe}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Users className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Demographic</p>
                  <p className="text-sm text-gray-900">{study.demographic}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Target className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Size</p>
                  <p className="text-sm text-gray-900">{study.size}</p>
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

            <p className="text-gray-600 mb-4">{study.description}</p>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium text-gray-900 mb-2">
                  Key Outcomes
                </h4>
                <ul className="space-y-1">
                  {study.keyOutcomes.map((outcome, index) => (
                    <li
                      key={index}
                      className="text-sm text-gray-600 flex gap-2"
                    >
                      <span className="text-gray-400 flex-shrink-0">
                        &bull;
                      </span>
                      <span>{outcome}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-2">
                  Implementation Steps
                </h4>
                <ol className="space-y-1">
                  {study.implementationSteps.map((step, index) => (
                    <li
                      key={index}
                      className="text-sm text-gray-600 flex gap-2"
                    >
                      <span className="text-gray-400 flex-shrink-0">
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

      {filteredCaseStudies.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">
            No case studies match your selected filters. Try adjusting your
            criteria.
          </p>
        </div>
      )}
    </div>
  );
}
