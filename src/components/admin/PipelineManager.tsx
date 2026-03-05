import { useState } from 'react';
import {
  Upload,
  Link as LinkIcon,
  FileText,
  Table,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Play,
  Globe,
  Eye,
  ArrowLeft,
  Sparkles,
  Send,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';

type IngestMode = 'pdf' | 'url' | 'text' | 'bulk';

interface IngestResult {
  success: boolean;
  registryPath?: string;
  error?: string;
  note?: string;
}

export function PipelineManager() {
  const [activeTab, setActiveTab] = useState<IngestMode>('text');

  return (
    <div className="space-y-6">
      <div>
        <h2
          className="text-2xl text-[#124D8F]"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Pipeline Manager
        </h2>
        <p className="text-gray-500 text-sm mt-1">
          Ingest new documents into the knowledge base
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as IngestMode)}>
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="text" className="gap-1.5">
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Paste Text</span>
          </TabsTrigger>
          <TabsTrigger value="url" className="gap-1.5">
            <Globe className="w-4 h-4" />
            <span className="hidden sm:inline">From URL</span>
          </TabsTrigger>
          <TabsTrigger value="pdf" className="gap-1.5">
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Upload PDF</span>
          </TabsTrigger>
          <TabsTrigger value="bulk" className="gap-1.5">
            <Table className="w-4 h-4" />
            <span className="hidden sm:inline">Bulk</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="text">
          <TextIngestForm />
        </TabsContent>
        <TabsContent value="url">
          <UrlIngestForm />
        </TabsContent>
        <TabsContent value="pdf">
          <PdfIngestForm />
        </TabsContent>
        <TabsContent value="bulk">
          <BulkInfo />
        </TabsContent>
      </Tabs>

      <PipelineControls />
    </div>
  );
}

// ── Text Ingest Form ────────────────────────────────────────

function TextIngestForm() {
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [docDate, setDocDate] = useState('');
  const [contentType, setContentType] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch('/api/admin/ingest/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, source, source_url: sourceUrl,
          doc_date: docDate, content_type: contentType || undefined,
          content,
        }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) {
        setName('');
        setSource('');
        setSourceUrl('');
        setDocDate('');
        setContentType('');
        setContent('');
      }
    } catch (err) {
      setResult({ success: false, error: 'Network error.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
      {/* Success/error banner */}
      {result?.success && !content && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <p className="font-medium">
            Document ingested successfully.
            {result.registryPath ? ` Registry: ${result.registryPath}` : ''}
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <FormField label="Document Name *" value={name} onChange={setName} placeholder="e.g. Toronto Citizens' Assembly" />
        <FormField label="Source Label *" value={source} onChange={setSource} placeholder="e.g. Participedia Case Studies" />
        <FormField label="Source URL" value={sourceUrl} onChange={setSourceUrl} placeholder="https://..." />
        <FormField label="Date" value={docDate} onChange={setDocDate} placeholder="YYYY-MM-DD" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Content Type
        </label>
        <select
          value={contentType}
          onChange={(e) => setContentType(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#124D8F]"
        >
          <option value="">Auto-detect (LLM classification)</option>
          {CONTENT_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Content (Markdown or plain text) *
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste the full document content here..."
          rows={12}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#124D8F] font-mono resize-y"
          required
        />
        <p className="text-xs text-gray-400 mt-1">
          {content.length.toLocaleString()} characters
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting || !name || !source || !content}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#124D8F] text-white text-sm font-medium rounded-md hover:bg-[#0e3d72] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FileText className="w-4 h-4" />
          )}
          Ingest Document
        </button>
        <ResultBadge result={result} />
      </div>
    </form>
  );
}

// ── URL Ingest Form ─────────────────────────────────────────

function UrlIngestForm() {
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [docDate, setDocDate] = useState('');
  const [contentType, setContentType] = useState('');
  const [content, setContent] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [detectedFormat, setDetectedFormat] = useState<string>('');

  const [llmClassification, setLlmClassification] = useState<{ content_type: string; summary: string } | null>(null);
  const [classifying, setClassifying] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);

  const classifyContent = async (text: string, docName: string) => {
    setClassifying(true);
    try {
      const res = await fetch('/api/admin/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: docName, source, content: text }),
      });
      if (res.ok) {
        const data = await res.json();
        setLlmClassification(data);
        if (!contentType) setContentType(data.content_type);
      }
    } catch {
      // Classification is optional
    } finally {
      setClassifying(false);
    }
  };

  const handleFetch = async () => {
    setFetching(true);
    setFetchError('');
    setResult(null);
    setDetectedFormat('');
    setLlmClassification(null);

    try {
      const res = await fetch('/api/admin/ingest/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch URL');

      const title = data.suggestedTitle || '';
      const extractedContent = data.extractedContent || '';
      setName(title);
      setSourceUrl(url);
      setContent(extractedContent);
      setDetectedFormat(data.format || 'html');
      setShowEditor(true);

      if (extractedContent.length > 30) {
        classifyContent(extractedContent, title);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch URL.');
    } finally {
      setFetching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch('/api/admin/ingest/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, source, source_url: sourceUrl,
          doc_date: docDate, content_type: contentType || undefined,
          content,
        }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) {
        setUrl('');
        setName('');
        setSource('');
        setSourceUrl('');
        setDocDate('');
        setContentType('');
        setContent('');
        setShowEditor(false);
        setLlmClassification(null);
      }
    } catch {
      setResult({ success: false, error: 'Network error.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      {/* Step 1: Fetch */}
      <div className="flex gap-3">
        <div className="flex-1">
          <FormField
            label="URL to fetch"
            value={url}
            onChange={setUrl}
            placeholder="https://example.com/article"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={handleFetch}
            disabled={fetching || !url.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#124D8F] text-white text-sm font-medium rounded-md hover:bg-[#0e3d72] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer h-[38px]"
          >
            {fetching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Globe className="w-4 h-4" />
            )}
            Fetch
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="w-4 h-4" />
          {fetchError}
        </div>
      )}

      {/* Step 2: Review + metadata */}
      {showEditor && (
        <form onSubmit={handleSubmit} className="space-y-4 border-t border-gray-100 pt-4">
          {detectedFormat === 'pdf' ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
              <FileText className="w-4 h-4 flex-shrink-0" />
              PDF detected and converted to Markdown via Docling. Review the extracted content below.
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Review and edit the extracted content, then fill in metadata.
            </p>
          )}

          {/* LLM Classification Card */}
          <div className="p-4 bg-gradient-to-r from-[#E4EFFC]/60 to-purple-50/40 border border-[#124D8F]/10 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-[#124D8F]" />
              <span className="text-sm font-medium text-[#124D8F]">AI Classification</span>
            </div>
            {classifying ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Classifying document...
              </div>
            ) : llmClassification ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Suggested type:</span>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#124D8F]/10 text-[#124D8F]">
                    {llmClassification.content_type.replace(/_/g, ' ')}
                  </span>
                </div>
                {llmClassification.summary && (
                  <p className="text-sm text-gray-600">{llmClassification.summary}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Classification unavailable.</p>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <FormField label="Document Name *" value={name} onChange={setName} placeholder="Document title" />
            <FormField label="Source Label *" value={source} onChange={setSource} placeholder="e.g. Blog, Report" />
            <FormField label="Source URL" value={sourceUrl} onChange={setSourceUrl} placeholder="https://..." />
            <FormField label="Date" value={docDate} onChange={setDocDate} placeholder="YYYY-MM-DD" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Content Type
            </label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#124D8F]"
            >
              <option value="">Auto-detect (LLM classification)</option>
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-700">
                Extracted Content (editable)
              </label>
              <span className="text-xs text-gray-400">
                {content.length.toLocaleString()} characters
              </span>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#124D8F] font-mono resize-y"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting || !name || !source || !content}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#124D8F] text-white text-sm font-medium rounded-md hover:bg-[#0e3d72] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Confirm & Ingest
            </button>
            <ResultBadge result={result} />
          </div>
        </form>
      )}
    </div>
  );
}

// ── PDF Ingest Form (multi-step: upload → preview → confirm) ─

type PdfStep = 'upload' | 'converting' | 'preview' | 'ingesting' | 'done';

interface ConvertResult {
  content: string;
  pdfPath: string;
  charCount: number;
}

interface ClassifyResult {
  content_type: string;
  summary: string;
}

function PdfIngestForm() {
  const [step, setStep] = useState<PdfStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [convertError, setConvertError] = useState('');

  // Preview state
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null);
  const [previewContent, setPreviewContent] = useState('');
  const [source, setSource] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [docDate, setDocDate] = useState('');
  const [contentType, setContentType] = useState('');
  const [llmClassification, setLlmClassification] = useState<ClassifyResult | null>(null);
  const [classifying, setClassifying] = useState(false);

  // Ingest state
  const [result, setResult] = useState<IngestResult | null>(null);
  const [lastIngestedName, setLastIngestedName] = useState('');

  const handleFile = (f: File) => {
    setFile(f);
    setConvertError('');
    setResult(null);
    setLastIngestedName('');
    if (!name) setName(f.name.replace(/\.pdf$/i, ''));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type === 'application/pdf') handleFile(f);
  };

  const handleConvert = async () => {
    if (!file) return;
    setStep('converting');
    setConvertError('');

    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch('/api/admin/ingest/pdf/convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          'X-Filename': file.name,
          'X-Doc-Name': encodeURIComponent(name),
        },
        body: buffer,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Conversion failed.');

      setConvertResult(data);
      setPreviewContent(data.content);
      setStep('preview');

      // Kick off LLM classification in background
      classifyContent(data.content);
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : 'Conversion failed.');
      setStep('upload');
    }
  };

  const classifyContent = async (content: string) => {
    setClassifying(true);
    try {
      const res = await fetch('/api/admin/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, source, content }),
      });
      if (res.ok) {
        const data = await res.json();
        setLlmClassification(data);
        if (!contentType) setContentType(data.content_type);
      }
    } catch {
      // Classification is optional; don't block the flow
    } finally {
      setClassifying(false);
    }
  };

  const handleConfirm = async () => {
    if (!convertResult) return;
    setStep('ingesting');
    setResult(null);

    try {
      const res = await fetch('/api/admin/ingest/pdf/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          source: source || 'PDF Upload',
          source_url: sourceUrl,
          doc_date: docDate,
          content_type: contentType || undefined,
          content: previewContent,
          pdfPath: convertResult.pdfPath,
        }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) {
        setLastIngestedName(name);
        setStep('done');
      } else {
        setStep('preview');
      }
    } catch {
      setResult({ success: false, error: 'Ingestion failed.' });
      setStep('preview');
    }
  };

  const handleReset = () => {
    setStep('upload');
    setFile(null);
    setName('');
    setSource('');
    setSourceUrl('');
    setDocDate('');
    setContentType('');
    setConvertResult(null);
    setPreviewContent('');
    setLlmClassification(null);
    setConvertError('');
  };

  // ── Step: Done ──
  if (step === 'done') {
    return (
      <div className="space-y-4 mt-4">
        <div className="flex items-start gap-3 px-5 py-4 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle2 className="w-6 h-6 text-green-600 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="font-medium text-green-800">
              "{lastIngestedName}" ingested successfully
            </p>
            <p className="text-sm text-green-700">
              PDF converted via Docling, classified as <span className="font-medium">{contentType || 'auto'}</span>, and added to the knowledge base.
            </p>
            {result?.registryPath && (
              <p className="text-xs text-green-600 font-mono">
                Registry: {result.registryPath}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 rounded-md text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
        >
          <Upload className="w-4 h-4" />
          Upload another PDF
        </button>
      </div>
    );
  }

  // ── Step: Preview ──
  if (step === 'preview' || step === 'ingesting') {
    return (
      <div className="space-y-5 mt-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleReset}
            disabled={step === 'ingesting'}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Eye className="w-4 h-4" />
            Preview &amp; Review
          </div>
        </div>

        {/* LLM Classification Card */}
        <div className="p-4 bg-gradient-to-r from-[#E4EFFC]/60 to-purple-50/40 border border-[#124D8F]/10 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-[#124D8F]" />
            <span className="text-sm font-medium text-[#124D8F]">AI Classification</span>
          </div>
          {classifying ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Classifying document...
            </div>
          ) : llmClassification ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Suggested type:</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#124D8F]/10 text-[#124D8F]">
                  {llmClassification.content_type.replace(/_/g, ' ')}
                </span>
              </div>
              {llmClassification.summary && (
                <p className="text-sm text-gray-600">{llmClassification.summary}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Classification unavailable.</p>
          )}
        </div>

        {/* Metadata */}
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Document Name *" value={name} onChange={setName} placeholder="Document title" />
          <FormField label="Source Label" value={source} onChange={setSource} placeholder="e.g. Academic Paper" />
          <FormField label="Source URL" value={sourceUrl} onChange={setSourceUrl} placeholder="https://..." />
          <FormField label="Date" value={docDate} onChange={setDocDate} placeholder="YYYY-MM-DD" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Content Type
          </label>
          <select
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#124D8F]"
          >
            <option value="">Auto-detect (LLM classification)</option>
            {CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        {/* Content preview */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-gray-700">
              Converted Content (editable)
            </label>
            <span className="text-xs text-gray-400">
              {previewContent.length.toLocaleString()} characters
            </span>
          </div>
          <textarea
            value={previewContent}
            onChange={(e) => setPreviewContent(e.target.value)}
            rows={14}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#124D8F] font-mono resize-y"
          />
        </div>

        {/* Error */}
        {result && !result.success && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{result.error || 'Ingestion failed.'}</p>
          </div>
        )}

        {/* Confirm button */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={step === 'ingesting' || !name || !previewContent}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#124D8F] text-white text-sm font-medium rounded-md hover:bg-[#0e3d72] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {step === 'ingesting' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {step === 'ingesting' ? 'Ingesting...' : 'Confirm & Ingest'}
          </button>
        </div>
      </div>
    );
  }

  // ── Step: Upload ──
  return (
    <div className="space-y-4 mt-4">
      {/* Success banner from previous upload */}
      {lastIngestedName && result?.success && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <p className="font-medium">"{lastIngestedName}" was ingested successfully.</p>
        </div>
      )}

      {convertError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{convertError}</p>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive
            ? 'border-[#124D8F] bg-[#E4EFFC]/50'
            : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <FileText className="w-6 h-6 text-[#124D8F]" />
            <span className="text-sm font-medium text-gray-900">{file.name}</span>
            <span className="text-xs text-gray-400">
              ({(file.size / 1024 / 1024).toFixed(1)} MB)
            </span>
            <button
              type="button"
              onClick={() => { setFile(null); setName(''); }}
              className="text-gray-400 hover:text-red-500 cursor-pointer ml-2"
            >
              Remove
            </button>
          </div>
        ) : (
          <>
            <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              Drag and drop a PDF here, or{' '}
              <label className="text-[#124D8F] font-medium cursor-pointer hover:underline">
                browse
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </label>
            </p>
          </>
        )}
      </div>

      {file && (
        <>
          <FormField label="Document Name *" value={name} onChange={setName} placeholder="Document title" />

          <button
            type="button"
            onClick={handleConvert}
            disabled={step === 'converting' || !name}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#124D8F] text-white text-sm font-medium rounded-md hover:bg-[#0e3d72] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {step === 'converting' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Converting PDF...
              </>
            ) : (
              <>
                <Eye className="w-4 h-4" />
                Convert & Preview
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}

// ── Bulk Info ────────────────────────────────────────────────

function BulkInfo() {
  return (
    <div className="mt-4 p-6 border border-gray-200 rounded-lg bg-white">
      <div className="flex items-start gap-3">
        <Table className="w-5 h-5 text-[#124D8F] mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="font-medium text-gray-900 mb-2">Bulk Upload (Excel/CSV)</h3>
          <p className="text-sm text-gray-600 mb-3">
            For bulk ingestion of multiple documents at once, use the existing CLI pipeline
            with the Excel format matching <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">Data Tracker.xlsx</code>.
          </p>
          <div className="bg-gray-50 rounded-md p-3">
            <code className="text-xs text-gray-700 block">
              npm run ingest:excel          # full pipeline
            </code>
            <code className="text-xs text-gray-700 block mt-1">
              npm run ingest:excel:clear    # clear + re-ingest
            </code>
            <code className="text-xs text-gray-700 block mt-1">
              npm run ingest:excel:dry      # dry run (stats only)
            </code>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Or use the migration script to convert Excel rows to JSON registry files:
          </p>
          <div className="bg-gray-50 rounded-md p-3 mt-1">
            <code className="text-xs text-gray-700 block">
              python scripts/migrate-excel-to-json.py
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pipeline Controls ───────────────────────────────────────

function PipelineControls() {
  const [running, setRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<string | null>(null);

  const runPipeline = async (mode: string) => {
    setRunning(true);
    setPipelineResult(null);

    try {
      const res = await fetch('/api/admin/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (data.error) {
        setPipelineResult(`Error: ${data.error}`);
      } else {
        setPipelineResult('Pipeline completed successfully.');
      }
    } catch {
      setPipelineResult('Pipeline request failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="border-t border-gray-100 pt-6">
      <h3 className="text-sm font-medium text-gray-700 mb-3">
        Full Pipeline Controls
      </h3>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => runPipeline('full')}
          disabled={running}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 rounded-md text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {running ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          Run Full Pipeline
        </button>
        <button
          onClick={() => runPipeline('clear')}
          disabled={running}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-red-200 rounded-md text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer"
        >
          Clear & Re-ingest
        </button>
      </div>
      {pipelineResult && (
        <p className={`text-sm mt-2 ${pipelineResult.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
          {pipelineResult}
        </p>
      )}
    </div>
  );
}

// ── Shared Components ───────────────────────────────────────

const CONTENT_TYPES = [
  'case_study', 'transcript', 'blog_post', 'journal_article',
  'report', 'guide', 'policy_brief', 'lecture', 'tool_or_resource', 'other',
];

function FormField({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required || label.includes('*')}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#124D8F]"
      />
    </div>
  );
}

function ResultBadge({ result }: { result: IngestResult | null }) {
  if (!result) return null;

  if (result.success) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
        <CheckCircle2 className="w-4 h-4" />
        Ingested{result.registryPath ? ` → ${result.registryPath}` : ''}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-red-600">
      <AlertCircle className="w-4 h-4" />
      {result.error || result.note || 'Failed'}
    </span>
  );
}
