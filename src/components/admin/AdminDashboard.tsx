import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { getAdminAuthHeader } from './AdminLayout';
import {
  Database,
  FileText,
  FolderOpen,
  Loader2,
  RefreshCw,
  ArrowRight,
  BarChart3,
} from 'lucide-react';

interface Stats {
  collections: {
    coachingTool: { name: string; count: number };
    caseStudyLibrary: { name: string; count: number };
  };
  totalChunks: number;
  totalCaseStudies: number;
  registryFiles: number;
  breakdowns: {
    docType: Record<string, number>;
    contentType: Record<string, number>;
    source: Record<string, number>;
  };
}

export function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/stats', { headers: getAdminAuthHeader() });
      if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
      setStats(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <Loader2 className="w-8 h-8 text-[#124D8F] animate-spin" />
        <p className="text-gray-500 font-medium">Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16 space-y-4">
        <p className="text-gray-600">{error}</p>
        <button
          onClick={fetchStats}
          className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-[#E4EFFC] transition-colors cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!stats) return null;

  const statCards = [
    {
      label: 'Total Chunks',
      value: stats.totalChunks.toLocaleString(),
      icon: Database,
      description: stats.collections.coachingTool.name,
    },
    {
      label: 'Case Studies',
      value: stats.totalCaseStudies.toLocaleString(),
      icon: FileText,
      description: stats.collections.caseStudyLibrary.name,
    },
    {
      label: 'Registry Files',
      value: stats.registryFiles.toLocaleString(),
      icon: FolderOpen,
      description: 'data/registry/',
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-2xl text-[#124D8F]"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Overview
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            Data pipeline health and collection statistics
          </p>
        </div>
        <button
          onClick={fetchStats}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid sm:grid-cols-3 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="border border-gray-200 rounded-lg p-5 bg-white"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-[#E4EFFC] rounded-md">
                <card.icon className="w-5 h-5 text-[#124D8F]" />
              </div>
              <span className="text-sm font-medium text-gray-500">
                {card.label}
              </span>
            </div>
            <p className="text-3xl font-semibold text-gray-900">{card.value}</p>
            <p className="text-xs text-gray-400 mt-1">{card.description}</p>
          </div>
        ))}
      </div>

      {/* Breakdowns */}
      <div className="grid md:grid-cols-2 gap-6">
        <BreakdownCard
          title="By Content Type"
          data={stats.breakdowns.contentType}
        />
        <BreakdownCard
          title="By Document Type"
          data={stats.breakdowns.docType}
        />
      </div>

      {Object.keys(stats.breakdowns.source).length > 0 && (
        <BreakdownCard
          title="By Source"
          data={stats.breakdowns.source}
        />
      )}

      {/* Quick links */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Link
          to="/admin/documents"
          className="flex items-center justify-between p-5 border border-gray-200 rounded-lg bg-white hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-[#124D8F]" />
            <div>
              <p className="font-medium text-gray-900">Document Explorer</p>
              <p className="text-sm text-gray-500">
                Browse, search, and manage documents in Weaviate
              </p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-[#124D8F] transition-colors" />
        </Link>
        <Link
          to="/admin/pipeline"
          className="flex items-center justify-between p-5 border border-gray-200 rounded-lg bg-white hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-[#124D8F]" />
            <div>
              <p className="font-medium text-gray-900">Pipeline Manager</p>
              <p className="text-sm text-gray-500">
                Ingest new documents via PDF, URL, or text
              </p>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-[#124D8F] transition-colors" />
        </Link>
      </div>
    </div>
  );
}

function BreakdownCard({
  title,
  data,
}: {
  title: string;
  data: Record<string, number>;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  if (entries.length === 0) {
    return (
      <div className="border border-gray-200 rounded-lg p-5 bg-white">
        <h3 className="font-medium text-gray-700 mb-3">{title}</h3>
        <p className="text-sm text-gray-400">No data available</p>
      </div>
    );
  }

  const COLORS = [
    'bg-[#124D8F]',
    'bg-[#FDCE3E]',
    'bg-[#3B82F6]',
    'bg-[#10B981]',
    'bg-[#F59E0B]',
    'bg-[#8B5CF6]',
    'bg-[#EF4444]',
    'bg-[#6366F1]',
    'bg-[#EC4899]',
    'bg-[#14B8A6]',
  ];

  return (
    <div className="border border-gray-200 rounded-lg p-5 bg-white">
      <h3 className="font-medium text-gray-700 mb-4">{title}</h3>

      {/* Bar */}
      <div className="flex rounded-full overflow-hidden h-3 mb-4">
        {entries.map(([key, value], i) => (
          <div
            key={key}
            className={`${COLORS[i % COLORS.length]} transition-all`}
            style={{ width: `${(value / total) * 100}%` }}
            title={`${key}: ${value}`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="space-y-2">
        {entries.map(([key, value], i) => (
          <div key={key} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-3 h-3 rounded-sm ${COLORS[i % COLORS.length]}`}
              />
              <span className="text-gray-600">{key}</span>
            </div>
            <span className="text-gray-900 font-medium tabular-nums">
              {value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
