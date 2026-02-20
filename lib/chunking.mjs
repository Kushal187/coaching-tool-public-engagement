// lib/chunking.mjs
// ─────────────────────────────────────────────────────────────
// Structure-aware document chunking for Docling-converted Markdown.
//
// Approach:
//   1. Parse Markdown headings (#, ##, ###) to identify sections.
//   2. Split on heading boundaries into semantically coherent chunks.
//   3. Sub-split oversized sections at paragraph boundaries.
//   4. Add ~300 char overlap between consecutive chunks.
//   5. Prepend a contextual retrieval prefix to each chunk
//      (document title + section path) to improve embedding quality.
//
// Fallback: a simple character-boundary splitter for plain text.
// ─────────────────────────────────────────────────────────────

const MAX_CHUNK_CHARS = 2000;
const OVERLAP_CHARS = 300;

// ─── Heading-based section parser ────────────────────────────

/**
 * Regex that matches Markdown headings (# through ####).
 * Captures: level (number of #'s) and the heading text.
 */
const HEADING_RE = /^(#{1,4})\s+(.+)$/;

/**
 * Parse structured Markdown into an array of sections.
 * Each section has: { level, title, content, lineIndex }
 */
function parseSections(markdown) {
  const lines = markdown.split('\n');
  const sections = [];
  let currentSection = null;
  let contentLines = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(HEADING_RE);

    if (match) {
      // Flush the previous section
      if (currentSection) {
        currentSection.content = contentLines.join('\n').trim();
        sections.push(currentSection);
      }

      currentSection = {
        level: match[1].length,
        title: match[2].trim(),
        content: '',
        lineIndex: i,
      };
      contentLines = [];
    } else {
      contentLines.push(lines[i]);
    }
  }

  // Flush the last section
  if (currentSection) {
    currentSection.content = contentLines.join('\n').trim();
    sections.push(currentSection);
  }

  // If no headings were found at all, treat the whole text as one section
  if (sections.length === 0) {
    sections.push({
      level: 1,
      title: '',
      content: markdown.trim(),
      lineIndex: 0,
    });
  }

  return sections;
}

// ─── Section path builder ────────────────────────────────────

/**
 * Build the heading hierarchy path for each section.
 * e.g. "Introduction > Background > History"
 *
 * Tracks the current heading stack by level and produces a
 * breadcrumb-style path for each section.
 */
function buildSectionPaths(sections) {
  const stack = []; // [ { level, title } ]

  return sections.map((section) => {
    // Pop everything at the same level or deeper
    while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
      stack.pop();
    }
    stack.push({ level: section.level, title: section.title });

    const path = stack.map((s) => s.title).join(' > ');
    return { ...section, sectionPath: path };
  });
}

// ─── Sub-splitting for oversized sections ────────────────────

/**
 * Split a long text into pieces at paragraph boundaries,
 * each no larger than MAX_CHUNK_CHARS, with OVERLAP_CHARS overlap.
 */
function splitAtParagraphs(text) {
  if (text.length <= MAX_CHUNK_CHARS) {
    return [text];
  }

  // Split into paragraphs (double newline or more)
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    const candidate = currentChunk
      ? currentChunk + '\n\n' + para
      : para;

    if (candidate.length > MAX_CHUNK_CHARS && currentChunk.length > 0) {
      // Flush the current chunk
      chunks.push(currentChunk.trim());
      // Start new chunk with overlap from the end of previous
      const overlap = getOverlapTail(currentChunk);
      currentChunk = overlap ? overlap + '\n\n' + para : para;
    } else {
      currentChunk = candidate;
    }
  }

  // Flush remaining
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // If we ended up with nothing (e.g. single giant paragraph), use character split
  if (chunks.length === 0) {
    return charSplit(text);
  }

  return chunks;
}

/**
 * Get the trailing ~OVERLAP_CHARS of text, breaking at a sentence
 * or word boundary.
 */
function getOverlapTail(text) {
  if (text.length <= OVERLAP_CHARS) return text;

  const tail = text.slice(-OVERLAP_CHARS);
  // Try to start at a sentence boundary
  const sentenceStart = tail.indexOf('. ');
  if (sentenceStart !== -1 && sentenceStart < OVERLAP_CHARS * 0.5) {
    return tail.slice(sentenceStart + 2);
  }
  // Otherwise break at a word boundary
  const wordStart = tail.indexOf(' ');
  if (wordStart !== -1) {
    return tail.slice(wordStart + 1);
  }
  return tail;
}

/**
 * Last-resort character-level split with overlap.
 */
function charSplit(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX_CHUNK_CHARS, text.length);
    // Try to break at a sentence or word boundary
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'));
      if (lastBreak > MAX_CHUNK_CHARS * 0.5) end = start + lastBreak + 1;
    }
    chunks.push(text.slice(start, end).trim());
    start = end - OVERLAP_CHARS;
    if (start < 0) start = 0;
    if (end >= text.length) break;
  }
  return chunks.filter(Boolean);
}

// ─── Contextual prefix ──────────────────────────────────────

/**
 * Build a contextual retrieval prefix for a chunk.
 * This is prepended to the chunk content before embedding,
 * giving the embedding model richer context about where the
 * chunk fits in the document.
 */
function buildContextPrefix(title, sectionPath) {
  const parts = [];
  if (title) parts.push(`Document: ${title}`);
  if (sectionPath) parts.push(`Section: ${sectionPath}`);
  return parts.length > 0 ? parts.join(' | ') : '';
}

// ─── Simple character-boundary fallback ─────────────────────

const SIMPLE_CHUNK_SIZE = 1500; // characters
const SIMPLE_OVERLAP = 300;

function simpleChunk(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + SIMPLE_CHUNK_SIZE, text.length);
    // Try to break at a sentence or word boundary
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'));
      if (lastBreak > SIMPLE_CHUNK_SIZE * 0.5) end = start + lastBreak + 1;
    }
    chunks.push(text.slice(start, end).trim());
    start = end - SIMPLE_OVERLAP;
    if (start < 0) start = 0;
    if (end >= text.length) break;
  }
  return chunks.filter(Boolean);
}

// ─── Main chunking logic ────────────────────────────────────

/**
 * Chunk a Markdown document using heading-based structure-aware
 * splitting with contextual retrieval prefixes.
 *
 * Returns an array of objects ready for Weaviate indexing:
 *   { objectId, sourceFile, title, chapterTitle, sectionPath,
 *     contextPrefix, content, chunkIndex }
 */
export function chunkDocument({ text, sourceFile, title, simple = false }) {
  let rawChunks;

  if (simple) {
    // Simple fallback — no structure awareness
    rawChunks = simpleChunk(text).map((content) => ({
      chapterTitle: '',
      sectionPath: '',
      contextPrefix: buildContextPrefix(title, ''),
      content,
    }));
  } else {
    // Structure-aware chunking
    const sections = parseSections(text);
    const withPaths = buildSectionPaths(sections);

    rawChunks = [];

    for (const section of withPaths) {
      const contextPrefix = buildContextPrefix(title, section.sectionPath);

      // Include the heading as part of the chunk content
      const headingLine = section.title
        ? '#'.repeat(section.level) + ' ' + section.title
        : '';
      const fullContent = headingLine
        ? headingLine + '\n\n' + section.content
        : section.content;

      if (!fullContent.trim()) continue; // skip empty sections

      if (fullContent.length > MAX_CHUNK_CHARS) {
        // Sub-split oversized sections
        const subChunks = splitAtParagraphs(fullContent);
        for (let j = 0; j < subChunks.length; j++) {
          rawChunks.push({
            chapterTitle: section.title
              ? `${section.title} (part ${j + 1})`
              : `Part ${j + 1}`,
            sectionPath: section.sectionPath,
            contextPrefix,
            content: subChunks[j],
          });
        }
      } else {
        rawChunks.push({
          chapterTitle: section.title,
          sectionPath: section.sectionPath,
          contextPrefix,
          content: fullContent,
        });
      }
    }
  }

  return rawChunks.map((c, i) => ({
    objectId: `${sourceFile}::chunk-${i}`,
    sourceFile,
    title,
    chapterTitle: c.chapterTitle,
    sectionPath: c.sectionPath,
    contextPrefix: c.contextPrefix,
    content: c.content,
    chunkIndex: i,
  }));
}
