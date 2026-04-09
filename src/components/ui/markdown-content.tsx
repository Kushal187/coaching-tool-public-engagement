import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// NOTE: Citation rendering contract
// The prompts now instruct the LLM to emit numbered inline citations (¹²³…)
// followed by a "**Sources:**" section at the end of the message, with each
// source as a markdown hyperlink:
//
//   Some statement¹.
//
//   **Sources:**
//   1. [Title](https://url)
//
// react-markdown + remark-gfm renders this natively — the superscript glyphs
// are real Unicode characters (pass-through text), and the Sources list is a
// standard markdown ordered list with links that gets the `a` component
// override below. No custom parsing or pill rendering is needed.
//
// The `sources` prop is accepted (still passed by UnifiedChat from the SSE
// metadata) but intentionally unused inside this component — the LLM's own
// Sources section replaces what the prop used to render.

type SourceInfo = {
  title: string;
  sourceFile?: string;
  sourceUrl?: string;
  contentTypeLabel?: string | null;
};

type Props = {
  children: string;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sources?: SourceInfo[];
  compact?: boolean;
};

export function MarkdownContent({ children, compact = false }: Props) {
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
            {c}
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
            {c}
          </li>
        ),
        strong: ({ children: c }) => (
          <strong className="font-semibold text-gray-900">{c}</strong>
        ),
        em: ({ children: c }) => {
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
