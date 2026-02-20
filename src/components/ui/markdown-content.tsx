import { Children, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink } from 'lucide-react';

type SourceInfo = {
  title: string;
  sourceUrl?: string;
  contentTypeLabel?: string | null;
};

type Props = {
  children: string;
  sources?: SourceInfo[];
  compact?: boolean;
};

const CITATION_RE = /\[Source:\s*"?([^"\]]+?)"?(?:,\s*[\w_]+)?\]/g;

function cleanName(raw: string): string {
  return raw
    .replace(/\bREVIEWED\b/gi, '')
    .replace(/\bInternal\b/gi, '')
    .replace(/\bDRAFT\b/gi, '')
    .replace(/\bFINAL\b/gi, '')
    .replace(/^AI\//i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Builds a lowercase name → URL map with multiple lookup keys per source
 * (full title, base doc name without section, cleaned variant).
 */
function buildSourceMap(sources: SourceInfo[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of sources) {
    if (!s.sourceUrl) continue;
    const url = s.sourceUrl;
    const full = s.title.toLowerCase();
    map.set(full, url);

    const base = s.title.split(' — ')[0].trim().toLowerCase();
    if (base && base !== full) map.set(base, url);

    const cleaned = cleanName(full);
    if (cleaned && cleaned !== full && cleaned !== base) map.set(cleaned, url);

    const cleanedBase = cleanName(base);
    if (cleanedBase && cleanedBase !== base) map.set(cleanedBase, url);
  }
  return map;
}

function findUrl(name: string, map: Map<string, string>): string | undefined {
  if (map.size === 0) return undefined;
  const lower = name.toLowerCase().trim();

  if (map.has(lower)) return map.get(lower);

  const cleaned = cleanName(lower);
  if (cleaned !== lower && map.has(cleaned)) return map.get(cleaned);

  for (const [key, url] of map) {
    if (key.includes(lower) || lower.includes(key)) return url;
  }

  if (cleaned !== lower) {
    for (const [key, url] of map) {
      if (key.includes(cleaned) || cleaned.includes(key)) return url;
    }
  }

  return undefined;
}

function getTextContent(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return getTextContent((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

// ── Rendered elements ──────────────────────────────────────

function Citation({ name, url }: { name: string; url?: string }) {
  const label = cleanName(name);
  const base =
    'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 text-[11px] leading-tight font-medium rounded-md border align-baseline';

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} bg-[#E4EFFC] text-[#124D8F] border-[#124D8F]/20 hover:bg-[#124D8F]/15 hover:text-[#0e3d72] transition-colors no-underline`}
      >
        {label}
        <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
      </a>
    );
  }

  return <span className={`${base} bg-gray-50 text-gray-500 border-gray-200`}>{label}</span>;
}

function SourceLink({
  children,
  url,
}: {
  children: ReactNode;
  url: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-[#124D8F] underline decoration-[#124D8F]/30 hover:decoration-[#124D8F] transition-colors"
    >
      {children}
      <ExternalLink className="w-3 h-3 ml-0.5 inline-block align-baseline" />
    </a>
  );
}

// ── Text transforms ────────────────────────────────────────

function splitCitations(text: string, sourceMap: Map<string, string>): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(CITATION_RE.source, 'g');
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const name = m[1].trim();
    parts.push(<Citation key={`c${m.index}`} name={name} url={findUrl(name, sourceMap)} />);
    last = m.index + m[0].length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function withCitations(children: ReactNode, sourceMap: Map<string, string>): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string') {
      const parts = splitCitations(child, sourceMap);
      return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : <>{parts}</>;
    }
    return child;
  });
}

// ── Component ──────────────────────────────────────────────

export function MarkdownContent({ children, sources = [], compact = false }: Props) {
  const sourceMap = buildSourceMap(sources);

  const sz = compact
    ? { h1: 'text-sm', h2: 'text-sm', h3: 'text-[13px]', body: 'text-sm', code: 'text-xs' }
    : { h1: 'text-2xl', h2: 'text-xl', h3: 'text-base', body: 'text-[15px]', code: 'text-sm' };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children: c }) => (
          <h1 className={`${sz.h1} font-bold text-[#124D8F] ${compact ? 'mt-3 mb-1.5' : 'mt-6 mb-3'} first:mt-0`}>{c}</h1>
        ),
        h2: ({ children: c }) => (
          <h2 className={`${sz.h2} font-semibold text-[#124D8F] ${compact ? 'mt-3 mb-1.5' : 'mt-8 mb-3'} first:mt-0`}>{c}</h2>
        ),
        h3: ({ children: c }) => (
          <h3 className={`${sz.h3} font-semibold text-[#124D8F] ${compact ? 'mt-2 mb-1' : 'mt-6 mb-2'}`}>{c}</h3>
        ),
        p: ({ children: c }) => (
          <p className={`text-gray-700 ${compact ? 'mb-1.5' : 'mb-3'} leading-relaxed ${sz.body}`}>
            {withCitations(c, sourceMap)}
          </p>
        ),
        ul: ({ children: c }) => (
          <ul className={`${compact ? 'mb-2 space-y-0.5 pl-4' : 'mb-4 space-y-1.5 pl-5'} list-disc marker:text-[#FDCE3E]`}>{c}</ul>
        ),
        ol: ({ children: c }) => (
          <ol className={`${compact ? 'mb-2 space-y-0.5 pl-4' : 'mb-4 space-y-1.5 pl-5'} list-decimal marker:text-[#124D8F]`}>{c}</ol>
        ),
        li: ({ children: c }) => (
          <li className={`text-gray-700 leading-relaxed ${sz.body} ${compact ? 'pl-0.5' : 'pl-1'}`}>
            {withCitations(c, sourceMap)}
          </li>
        ),
        strong: ({ children: c }) => (
          <strong className="font-semibold text-gray-900">{c}</strong>
        ),
        em: ({ children: c }) => {
          const text = getTextContent(c);
          const url = text ? findUrl(text, sourceMap) : undefined;
          if (url) return <SourceLink url={url}>{c}</SourceLink>;
          return <em className="text-gray-600 not-italic font-medium">{c}</em>;
        },
        hr: () => <hr className={`${compact ? 'my-3' : 'my-6'} border-gray-200`} />,
        blockquote: ({ children: c }) => (
          <blockquote className={`border-l-[3px] border-[#124D8F] ${compact ? 'pl-3 my-2' : 'pl-4 my-4'} text-gray-600 italic`}>
            {c}
          </blockquote>
        ),
        a: ({ href, children: c }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#124D8F] underline decoration-[#124D8F]/30 hover:decoration-[#124D8F] transition-colors"
          >
            {c}
          </a>
        ),
        code: ({ children: c }) => (
          <code className={`px-1.5 py-0.5 bg-gray-100 text-gray-800 ${sz.code} rounded`}>{c}</code>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
