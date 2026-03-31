import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Filter,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Trash2,
  ExternalLink,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { getAdminAuthHeader } from './AdminLayout';

interface Document {
  document_id: string;
  doc_name: string;
  source_label: string;
  source_url: string;
  doc_type: string;
  content_type: string;
  doc_date: string;
  total_chunks: number;
  chunk_count: number;
}

interface DocumentDetail {
  document_id: string;
  doc_name: string;
  source_label: string;
  source_url: string;
  doc_type: string;
  content_type: string;
  doc_date: string;
  total_chunks: number;
  chunks: { chunk_index: number; section_name: string; content: string }[];
}

const PAGE_SIZE = 20;

export function DocumentExplorer() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [contentType, setContentType] = useState('');
  const [docType, setDocType] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchDocuments = useCallback(async (targetPage = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('pageSize', String(PAGE_SIZE));
      params.set('page', String(targetPage));
      if (contentType) params.set('content_type', contentType);
      if (docType) params.set('doc_type', docType);
      if (sourceLabel) params.set('source_label', sourceLabel);

      const res = await fetch(`/api/admin/documents?${params}`, { headers: getAdminAuthHeader() });
      if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
      const data = await res.json();
      setDocuments(data.documents || []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
      setPage(data.page ?? targetPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents.');
    } finally {
      setLoading(false);
    }
  }, [contentType, docType, sourceLabel]);

  useEffect(() => {
    setPage(1);
    fetchDocuments(1);
  }, [fetchDocuments]);

  const handleExpand = async (docId: string) => {
    if (expandedId === docId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }

    setExpandedId(docId);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/documents/${docId}`, { headers: getAdminAuthHeader() });
      if (!res.ok) throw new Error('Failed to load document details');
      setDetail(await res.json());
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDelete = async (docId: string, docName: string) => {
    if (!confirm(`Delete "${docName}" and all its chunks? This cannot be undone.`)) {
      return;
    }

    setDeleting(docId);
    try {
      const res = await fetch(`/api/admin/documents/${docId}`, { method: 'DELETE', headers: getAdminAuthHeader() });
      if (!res.ok) throw new Error('Delete failed');
      if (expandedId === docId) {
        setExpandedId(null);
        setDetail(null);
      }
      await fetchDocuments(page);
    } catch (err) {
      alert('Failed to delete document.');
    } finally {
      setDeleting(null);
    }
  };

  const contentTypes = [
    'case_study', 'transcript', 'blog_post', 'journal_article',
    'report', 'guide', 'policy_brief', 'lecture', 'tool_or_resource', 'other',
  ];

  const docTypes = [
    'participedia_case', 'govlab_resource', 'lecture_series', 'transcript',
    'reboot_democracy', 'policy_resource', 'academic_paper', 'external_resource',
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-2xl text-[#124D8F]"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Document Explorer
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            Browse and manage documents stored in Weaviate
          </p>
        </div>
        <button
          onClick={() => fetchDocuments(page)}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by document name..."
          className="w-full pl-10 pr-9 py-2.5 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#124D8F] focus:border-transparent bg-white text-sm"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="p-5 bg-[#E4EFFC]/40 border border-[#124D8F]/10 rounded-lg">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4 text-[#124D8F]" />
          <span className="text-sm font-medium text-[#124D8F]">Filters</span>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Content Type
            </label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#124D8F]"
            >
              <option value="">All</option>
              {contentTypes.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Document Type
            </label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#124D8F]"
            >
              <option value="">All</option>
              {docTypes.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Source Label
            </label>
            <input
              type="text"
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              placeholder="e.g. Participedia Case Studies"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#124D8F]"
            />
          </div>
        </div>
      </div>

      {/* Results */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-[#124D8F] animate-spin" />
        </div>
      )}

      {error && !loading && (
        <div className="text-center py-12">
          <p className="text-gray-500">{error}</p>
        </div>
      )}

      {!loading && !error && (() => {
        const query = searchQuery.toLowerCase().trim();
        const filtered = query
          ? documents.filter((d) =>
              (d.doc_name || '').toLowerCase().includes(query) ||
              (d.source_label || '').toLowerCase().includes(query)
            )
          : documents;

        const start = (page - 1) * PAGE_SIZE + 1;
        const end = (page - 1) * PAGE_SIZE + documents.length;

        return (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {total > 0
                ? `${start}–${end} of ${total} document${total !== 1 ? 's' : ''}${query ? ' (filtered by name)' : ''}`
                : 'No documents found'}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { const p = page - 1; setPage(p); fetchDocuments(p); }}
                  disabled={page <= 1}
                  className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-gray-600 tabular-nums px-2">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => { const p = page + 1; setPage(p); fetchDocuments(p); }}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            {filtered.map((doc) => (
              <div
                key={doc.document_id}
                className="border border-gray-200 rounded-lg bg-white overflow-hidden"
              >
                {/* Row */}
                <div className="flex items-center gap-4 px-5 py-3.5">
                  <button
                    onClick={() => handleExpand(doc.document_id)}
                    className="text-gray-400 hover:text-[#124D8F] cursor-pointer flex-shrink-0"
                  >
                    {expandedId === doc.document_id ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {doc.doc_name || 'Untitled'}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {doc.source_label}
                      {doc.doc_date ? ` · ${doc.doc_date}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="secondary" className="text-xs">
                      {doc.content_type?.replace(/_/g, ' ') || 'unknown'}
                    </Badge>
                    <span className="text-xs text-gray-400 tabular-nums w-16 text-right">
                      {doc.total_chunks} chunk{doc.total_chunks !== 1 ? 's' : ''}
                    </span>
                    {doc.source_url && (
                      <a
                        href={doc.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-[#124D8F]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => handleDelete(doc.document_id, doc.doc_name)}
                      disabled={deleting === doc.document_id}
                      className="text-gray-300 hover:text-red-500 cursor-pointer disabled:opacity-50"
                    >
                      {deleting === doc.document_id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded detail */}
                {expandedId === doc.document_id && (
                  <div className="border-t border-gray-100 px-5 py-4 bg-gray-50/50">
                    {detailLoading && (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading chunks...
                      </div>
                    )}

                    {!detailLoading && detail && (
                      <div className="space-y-4">
                        <div className="grid sm:grid-cols-4 gap-3 text-xs">
                          <div>
                            <span className="text-gray-400">Doc Type</span>
                            <p className="text-gray-700 font-medium">
                              {detail.doc_type?.replace(/_/g, ' ')}
                            </p>
                          </div>
                          <div>
                            <span className="text-gray-400">Content Type</span>
                            <p className="text-gray-700 font-medium">
                              {detail.content_type?.replace(/_/g, ' ')}
                            </p>
                          </div>
                          <div>
                            <span className="text-gray-400">Chunks</span>
                            <p className="text-gray-700 font-medium">
                              {detail.total_chunks}
                            </p>
                          </div>
                          <div>
                            <span className="text-gray-400">Document ID</span>
                            <p className="text-gray-700 font-mono text-[11px] truncate">
                              {detail.document_id}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-medium text-gray-500">
                            Chunks ({detail.chunks.length})
                          </p>
                          <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                            {detail.chunks.map((chunk) => (
                              <div
                                key={chunk.chunk_index}
                                className="p-3 bg-white border border-gray-100 rounded-md"
                              >
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-xs font-medium text-[#124D8F]">
                                    {chunk.section_name}
                                  </span>
                                  <span className="text-xs text-gray-400 tabular-nums">
                                    #{chunk.chunk_index}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-600 whitespace-pre-wrap line-clamp-4">
                                  {chunk.content}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-400">
                {query
                  ? `No documents on this page matching "${searchQuery}".`
                  : 'No documents found. Try adjusting filters or run the ingestion pipeline.'}
              </p>
            </div>
          )}

          {totalPages > 1 && filtered.length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <p className="text-sm text-gray-500">
                {start}–{end} of {total} document{total !== 1 ? 's' : ''}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { const p = page - 1; setPage(p); fetchDocuments(p); }}
                  disabled={page <= 1}
                  className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-gray-600 tabular-nums px-2">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => { const p = page + 1; setPage(p); fetchDocuments(p); }}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
        );
      })()}
    </div>
  );
}
