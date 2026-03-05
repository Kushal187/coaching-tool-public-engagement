// lib/admin-routes.mjs
// Admin API endpoints for the data dashboard.

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { weaviateClient } from './weaviate-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REGISTRY_DIR = path.join(ROOT, 'data', 'registry');
const DOCUMENTS_DIR = path.join(ROOT, 'documents');

const CT_COLLECTION = 'CoachingTool';
const CS_COLLECTION = 'CaseStudyLibrary';

const router = express.Router();

// ── Helpers ─────────────────────────────────────────────────

function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'untitled';
}

async function getCollectionCount(className) {
  try {
    const result = await weaviateClient.graphql
      .aggregate()
      .withClassName(className)
      .withFields('meta { count }')
      .do();
    return result?.data?.Aggregate?.[className]?.[0]?.meta?.count ?? 0;
  } catch {
    return 0;
  }
}

async function walkRegistry(dir) {
  const entries = [];
  let items;
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return entries;
  }

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...(await walkRegistry(fullPath)));
    } else if (item.name.endsWith('.json') && item.name !== 'schema.json') {
      try {
        const raw = await fs.readFile(fullPath, 'utf-8');
        const data = JSON.parse(raw);
        entries.push({
          path: path.relative(REGISTRY_DIR, fullPath),
          ...data,
        });
      } catch { /* skip malformed files */ }
    }
  }
  return entries;
}

// ── GET /api/admin/stats ────────────────────────────────────

router.get('/stats', async (_req, res) => {
  try {
    const [ctCount, csCount] = await Promise.all([
      getCollectionCount(CT_COLLECTION),
      getCollectionCount(CS_COLLECTION),
    ]);

    // Get doc_type and content_type breakdowns from CoachingTool
    let docTypeBreakdown = {};
    let contentTypeBreakdown = {};
    let sourceBreakdown = {};

    try {
      const ctAgg = await weaviateClient.graphql
        .aggregate()
        .withClassName(CT_COLLECTION)
        .withFields('doc_type { count topOccurrences { value occurs } } content_type { count topOccurrences { value occurs } } source_label { count topOccurrences { value occurs } }')
        .do();

      const agg = ctAgg?.data?.Aggregate?.[CT_COLLECTION]?.[0];
      if (agg) {
        for (const occ of agg.doc_type?.topOccurrences || []) {
          docTypeBreakdown[occ.value] = occ.occurs;
        }
        for (const occ of agg.content_type?.topOccurrences || []) {
          contentTypeBreakdown[occ.value] = occ.occurs;
        }
        for (const occ of agg.source_label?.topOccurrences || []) {
          sourceBreakdown[occ.value] = occ.occurs;
        }
      }
    } catch (err) {
      console.warn('Admin stats aggregation failed:', err.message);
    }

    // Count registry files
    const registryFiles = await walkRegistry(REGISTRY_DIR);

    res.json({
      collections: {
        coachingTool: { name: CT_COLLECTION, count: ctCount },
        caseStudyLibrary: { name: CS_COLLECTION, count: csCount },
      },
      totalChunks: ctCount,
      totalCaseStudies: csCount,
      registryFiles: registryFiles.length,
      breakdowns: {
        docType: docTypeBreakdown,
        contentType: contentTypeBreakdown,
        source: sourceBreakdown,
      },
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

// ── GET /api/admin/documents ────────────────────────────────

router.get('/documents', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    let builder = weaviateClient.graphql
      .get()
      .withClassName(CT_COLLECTION)
      .withFields('document_id doc_name source_label source_url doc_type content_type section_name chunk_index total_chunks doc_date')
      .withLimit(limit)
      .withOffset(offset);

    // Filtering
    const filters = [];
    if (req.query.content_type) {
      filters.push({
        path: ['content_type'],
        operator: 'Equal',
        valueText: req.query.content_type,
      });
    }
    if (req.query.doc_type) {
      filters.push({
        path: ['doc_type'],
        operator: 'Equal',
        valueText: req.query.doc_type,
      });
    }
    if (req.query.source_label) {
      filters.push({
        path: ['source_label'],
        operator: 'Equal',
        valueText: req.query.source_label,
      });
    }

    if (filters.length === 1) {
      builder = builder.withWhere(filters[0]);
    } else if (filters.length > 1) {
      builder = builder.withWhere({
        operator: 'And',
        operands: filters,
      });
    }

    const result = await builder.do();
    const hits = result?.data?.Get?.[CT_COLLECTION] ?? [];

    // Group by document_id to show unique documents
    const docMap = new Map();
    for (const hit of hits) {
      const id = hit.document_id;
      if (!docMap.has(id)) {
        docMap.set(id, {
          document_id: id,
          doc_name: hit.doc_name,
          source_label: hit.source_label,
          source_url: hit.source_url,
          doc_type: hit.doc_type,
          content_type: hit.content_type,
          doc_date: hit.doc_date,
          total_chunks: hit.total_chunks,
          chunk_count: 0,
        });
      }
      docMap.get(id).chunk_count++;
    }

    res.json({
      documents: Array.from(docMap.values()),
      totalReturned: hits.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Admin documents error:', error);
    res.status(500).json({ error: 'Failed to fetch documents.' });
  }
});

// ── GET /api/admin/documents/:id ────────────────────────────

router.get('/documents/:id', async (req, res) => {
  try {
    const result = await weaviateClient.graphql
      .get()
      .withClassName(CT_COLLECTION)
      .withFields('document_id doc_name source_label source_url doc_type content_type section_name chunk_index total_chunks doc_date content')
      .withWhere({
        path: ['document_id'],
        operator: 'Equal',
        valueText: req.params.id,
      })
      .withLimit(500)
      .do();

    const hits = result?.data?.Get?.[CT_COLLECTION] ?? [];
    if (hits.length === 0) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const chunks = hits
      .sort((a, b) => a.chunk_index - b.chunk_index)
      .map((h) => ({
        chunk_index: h.chunk_index,
        section_name: h.section_name,
        content: h.content,
      }));

    const first = hits[0];
    res.json({
      document_id: first.document_id,
      doc_name: first.doc_name,
      source_label: first.source_label,
      source_url: first.source_url,
      doc_type: first.doc_type,
      content_type: first.content_type,
      doc_date: first.doc_date,
      total_chunks: first.total_chunks,
      chunks,
    });
  } catch (error) {
    console.error('Admin document detail error:', error);
    res.status(500).json({ error: 'Failed to fetch document.' });
  }
});

// ── DELETE /api/admin/documents/:id ─────────────────────────

router.delete('/documents/:id', async (req, res) => {
  try {
    const docId = req.params.id;

    // Delete from CoachingTool
    try {
      await weaviateClient.batch
        .objectsBatchDeleter()
        .withClassName(CT_COLLECTION)
        .withWhere({
          path: ['document_id'],
          operator: 'Equal',
          valueText: docId,
        })
        .do();
    } catch (err) {
      console.warn(`Failed to delete from ${CT_COLLECTION}:`, err.message);
    }

    // Delete from CaseStudyLibrary if present
    try {
      await weaviateClient.batch
        .objectsBatchDeleter()
        .withClassName(CS_COLLECTION)
        .withWhere({
          path: ['document_id'],
          operator: 'Equal',
          valueText: docId,
        })
        .do();
    } catch (err) {
      console.warn(`Failed to delete from ${CS_COLLECTION}:`, err.message);
    }

    res.json({ success: true, deleted: docId });
  } catch (error) {
    console.error('Admin delete error:', error);
    res.status(500).json({ error: 'Failed to delete document.' });
  }
});

// ── GET /api/admin/registry ─────────────────────────────────

router.get('/registry', async (_req, res) => {
  try {
    const entries = await walkRegistry(REGISTRY_DIR);
    res.json({ entries, total: entries.length });
  } catch (error) {
    console.error('Admin registry error:', error);
    res.status(500).json({ error: 'Failed to read registry.' });
  }
});

// ── POST /api/admin/registry ────────────────────────────────

router.post('/registry', async (req, res) => {
  try {
    const { name, source, source_url, doc_date, content_type, content, format } = req.body;

    if (!name || !source || !content) {
      return res.status(400).json({ error: 'Missing required fields: name, source, content.' });
    }

    const sourceSlug = slugify(source);
    const dirPath = path.join(REGISTRY_DIR, sourceSlug);
    await fs.mkdir(dirPath, { recursive: true });

    const entry = {
      name,
      source,
      source_url: source_url || '',
      doc_date: doc_date || '',
      content_type: content_type || undefined,
      content,
      format: format || 'markdown',
    };

    let slug = slugify(name);
    let filepath = path.join(dirPath, `${slug}.json`);
    let i = 2;
    while (await fileExists(filepath)) {
      filepath = path.join(dirPath, `${slug}-${i}.json`);
      i++;
    }

    await fs.writeFile(filepath, JSON.stringify(entry, null, 2));

    res.json({
      success: true,
      path: path.relative(REGISTRY_DIR, filepath),
      entry,
    });
  } catch (error) {
    console.error('Admin registry create error:', error);
    res.status(500).json({ error: 'Failed to create registry entry.' });
  }
});

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ── POST /api/admin/ingest/text ─────────────────────────────

router.post('/ingest/text', async (req, res) => {
  try {
    const { name, source, source_url, doc_date, content_type, content } = req.body;

    if (!name || !source || !content) {
      return res.status(400).json({ error: 'Missing required fields: name, source, content.' });
    }

    // Write registry entry
    const sourceSlug = slugify(source);
    const dirPath = path.join(REGISTRY_DIR, sourceSlug);
    await fs.mkdir(dirPath, { recursive: true });

    const entry = {
      name,
      source,
      source_url: source_url || '',
      doc_date: doc_date || '',
      content_type: content_type || undefined,
      content,
      format: 'markdown',
    };

    let slug = slugify(name);
    let filepath = path.join(dirPath, `${slug}.json`);
    let i = 2;
    while (await fileExists(filepath)) {
      filepath = path.join(dirPath, `${slug}-${i}.json`);
      i++;
    }

    await fs.writeFile(filepath, JSON.stringify(entry, null, 2));

    // Trigger pipeline for this single file
    const relPath = path.relative(ROOT, filepath);
    const pipelineResult = await runPipelineForFile(relPath);

    res.json({
      success: true,
      registryPath: path.relative(REGISTRY_DIR, filepath),
      pipeline: pipelineResult,
    });
  } catch (error) {
    console.error('Admin ingest text error:', error);
    res.status(500).json({ error: 'Failed to ingest text.' });
  }
});

// ── POST /api/admin/ingest/url ──────────────────────────────

router.post('/ingest/url', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Missing required field: url.' });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CoachingTool/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain,*/*',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return res.status(400).json({ error: `Failed to fetch URL: ${response.status} ${response.statusText}` });
    }

    const contentTypeHeader = (response.headers.get('content-type') || '').toLowerCase();
    const isPdf = contentTypeHeader.includes('application/pdf') || url.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      // PDF URL: download binary, save to documents/, convert via Docling
      const buffer = Buffer.from(await response.arrayBuffer());

      // Derive a filename from the URL
      const urlPath = new URL(url).pathname;
      const urlFilename = path.basename(urlPath).replace(/\.pdf$/i, '') || 'url-download';
      const safeName = slugify(urlFilename) + '.pdf';

      await fs.mkdir(DOCUMENTS_DIR, { recursive: true });
      const pdfPath = path.join(DOCUMENTS_DIR, safeName);
      await fs.writeFile(pdfPath, buffer);

      // Run Docling to convert the PDF to Markdown
      const convertedDir = path.join(DOCUMENTS_DIR, 'converted');
      await fs.mkdir(convertedDir, { recursive: true });
      const mdFilename = slugify(urlFilename) + '.md';
      const mdPath = path.join(convertedDir, mdFilename);

      try {
        await runCommand('python3', ['scripts/convert-pdf-to-md.py', pdfPath, mdPath]);
      } catch (convErr) {
        console.error('Docling conversion failed:', convErr.message);
        await fs.unlink(pdfPath).catch(() => {});
        return res.status(500).json({
          error: 'PDF downloaded but Docling conversion failed. Make sure Docling is installed (pip install docling).',
        });
      }

      let extractedContent = '';
      try {
        extractedContent = await fs.readFile(mdPath, 'utf-8');
      } catch {
        return res.status(500).json({ error: 'Docling conversion produced no output.' });
      }

      const suggestedTitle = urlFilename.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      res.json({
        success: true,
        url,
        suggestedTitle,
        extractedContent,
        contentLength: extractedContent.length,
        format: 'pdf',
        pdfPath: path.relative(ROOT, pdfPath),
      });
    } else {
      // HTML / plain text URL: extract text from markup
      const html = await response.text();

      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, '\n')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim();

      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const suggestedTitle = titleMatch
        ? titleMatch[1].replace(/\s*[|–—-]\s*.+$/, '').trim()
        : '';

      res.json({
        success: true,
        url,
        suggestedTitle,
        extractedContent: text,
        contentLength: text.length,
        format: 'html',
      });
    }
  } catch (error) {
    console.error('Admin ingest URL error:', error);
    const message = error.name === 'TimeoutError'
      ? 'URL fetch timed out after 30 seconds.'
      : 'Failed to fetch URL content.';
    res.status(500).json({ error: message });
  }
});

// ── POST /api/admin/ingest/pdf ──────────────────────────────

const multerImport = async () => {
  // Lazy-load multer only when needed to avoid adding it as a hard dep
  try {
    const m = await import('multer');
    return m.default || m;
  } catch {
    return null;
  }
};

router.post('/ingest/pdf', express.raw({ type: 'application/pdf', limit: '50mb' }), async (req, res) => {
  try {
    const filename = req.headers['x-filename'] || 'upload.pdf';
    const name = decodeURIComponent(req.headers['x-doc-name'] || filename.replace(/\.pdf$/i, ''));
    const source = decodeURIComponent(req.headers['x-source'] || 'PDF Upload');
    const sourceUrl = decodeURIComponent(req.headers['x-source-url'] || '');
    const docDate = req.headers['x-doc-date'] || '';
    const contentType = req.headers['x-content-type'] || '';

    // 1. Save PDF to documents/
    await fs.mkdir(DOCUMENTS_DIR, { recursive: true });
    const safeName = slugify(name) + '.pdf';
    const pdfPath = path.join(DOCUMENTS_DIR, safeName);
    await fs.writeFile(pdfPath, req.body);
    console.log(`[admin/ingest/pdf] Saved PDF: ${pdfPath} (${(req.body.length / 1024 / 1024).toFixed(1)} MB)`);

    // 2. Convert PDF to Markdown via Docling
    const convertedDir = path.join(DOCUMENTS_DIR, 'converted');
    await fs.mkdir(convertedDir, { recursive: true });
    const mdFilename = slugify(name) + '.md';
    const mdPath = path.join(convertedDir, mdFilename);

    try {
      console.log(`[admin/ingest/pdf] Running Docling conversion...`);
      await runCommand('python3', ['scripts/convert-pdf-to-md.py', pdfPath, mdPath]);
      console.log(`[admin/ingest/pdf] Docling conversion complete: ${mdPath}`);
    } catch (convErr) {
      console.error('[admin/ingest/pdf] Docling conversion failed:', convErr.message);
      await fs.unlink(pdfPath).catch(() => {});
      return res.status(500).json({
        error: 'PDF saved but Docling conversion failed. Make sure Docling is installed (pip install docling).',
      });
    }

    // 3. Read the converted Markdown content
    let mdContent = '';
    try {
      mdContent = await fs.readFile(mdPath, 'utf-8');
    } catch {
      return res.status(500).json({ error: 'Docling conversion produced no output.' });
    }

    if (!mdContent.trim()) {
      return res.status(500).json({ error: 'Docling conversion produced empty output.' });
    }

    console.log(`[admin/ingest/pdf] Converted content: ${mdContent.length} chars`);

    // 4. Create registry entry WITH the converted Markdown content
    const sourceSlug = slugify(source);
    const dirPath = path.join(REGISTRY_DIR, sourceSlug);
    await fs.mkdir(dirPath, { recursive: true });

    const entry = {
      name,
      source,
      source_url: sourceUrl,
      doc_date: docDate,
      content_type: contentType || undefined,
      content: mdContent,
      format: 'markdown',
      pdf_path: path.relative(ROOT, pdfPath),
    };

    let slug = slugify(name);
    let filepath = path.join(dirPath, `${slug}.json`);
    let i = 2;
    while (await fileExists(filepath)) {
      filepath = path.join(dirPath, `${slug}-${i}.json`);
      i++;
    }

    await fs.writeFile(filepath, JSON.stringify(entry, null, 2));
    const registryRelPath = path.relative(ROOT, filepath);
    console.log(`[admin/ingest/pdf] Registry entry written: ${registryRelPath}`);

    // 5. Run the Python pipeline on this registry file to ingest into Weaviate
    let pipelineResult;
    try {
      console.log(`[admin/ingest/pdf] Running Python pipeline for: ${registryRelPath}`);
      pipelineResult = await runCommand('python3', [
        'scripts/ingest.py',
        '--source', 'registry',
        '--registry-file', registryRelPath,
      ]);
      console.log(`[admin/ingest/pdf] Pipeline complete.`);
    } catch (pipeErr) {
      console.warn('[admin/ingest/pdf] Pipeline failed:', pipeErr.message);
      pipelineResult = { success: false, error: pipeErr.message };
    }

    res.json({
      success: true,
      registryPath: path.relative(REGISTRY_DIR, filepath),
      pdfPath: path.relative(ROOT, pdfPath),
      pipeline: pipelineResult,
    });
  } catch (error) {
    console.error('Admin ingest PDF error:', error);
    res.status(500).json({ error: 'Failed to ingest PDF.' });
  }
});

// ── POST /api/admin/pipeline/run ────────────────────────────

let pipelineRunning = false;
let pipelineLog = [];
let pipelineStatus = { running: false, lastRun: null, lastResult: null };

router.post('/pipeline/run', async (req, res) => {
  if (pipelineRunning) {
    return res.status(409).json({ error: 'Pipeline is already running.' });
  }

  const { mode, source } = req.body;
  // mode: 'full' | 'incremental' | 'clear'
  // source: 'registry' | 'excel' | 'pdf'

  try {
    pipelineRunning = true;
    pipelineLog = [];
    pipelineStatus = { running: true, startedAt: new Date().toISOString(), mode, lastResult: null };

    const args = [];
    if (mode === 'clear') args.push('--clear');
    if (mode === 'incremental' || !mode) args.push('--dry-run'); // incremental not yet implemented, safe default

    if (source === 'pdf') {
      // Run PDF pipeline
      const result = await runCommand('npm', ['run', 'pipeline']);
      pipelineStatus = { running: false, lastRun: new Date().toISOString(), lastResult: result };
    } else {
      // Run Excel/registry pipeline
      const result = await runCommand('python3', ['scripts/ingest.py', ...args]);
      pipelineStatus = { running: false, lastRun: new Date().toISOString(), lastResult: result };
    }

    pipelineRunning = false;
    res.json({ success: true, status: pipelineStatus });
  } catch (error) {
    pipelineRunning = false;
    pipelineStatus = { running: false, lastRun: new Date().toISOString(), lastResult: { error: error.message } };
    console.error('Pipeline run error:', error);
    res.status(500).json({ error: 'Pipeline failed.' });
  }
});

// ── GET /api/admin/pipeline/status ──────────────────────────

router.get('/pipeline/status', (_req, res) => {
  res.json(pipelineStatus);
});

// ── Pipeline execution helpers ──────────────────────────────

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: ROOT });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      pipelineLog.push(data.toString());
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      pipelineLog.push(data.toString());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, stdout, stderr });
      } else {
        reject(new Error(`Process exited with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', reject);
  });
}

function runPipelineForFile(registryPath) {
  return runCommand('python3', [
    'scripts/ingest.py',
    '--source', 'registry',
    '--registry-file', registryPath,
  ]).catch((err) => {
    console.warn('Single-file pipeline failed:', err.message);
    return { success: false, error: err.message };
  });
}

export default router;
