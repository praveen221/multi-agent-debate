import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function TurnMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ ...props }) => (
          <p className="mb-3 text-sm leading-relaxed text-foreground/90 last:mb-0" {...props} />
        ),
        strong: ({ ...props }) => <strong className="font-semibold text-foreground" {...props} />,
        em: ({ ...props }) => <em className="italic" {...props} />,
        h1: ({ ...props }) => (
          <h3 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0" {...props} />
        ),
        h2: ({ ...props }) => (
          <h3 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0" {...props} />
        ),
        h3: ({ ...props }) => (
          <h4 className="mb-2 mt-3 text-sm font-semibold text-foreground first:mt-0" {...props} />
        ),
        ul: ({ ...props }) => (
          <ul className="mb-3 ml-5 list-disc space-y-1 text-sm leading-relaxed text-foreground/90" {...props} />
        ),
        ol: ({ ...props }) => (
          <ol className="mb-3 ml-5 list-decimal space-y-1 text-sm leading-relaxed text-foreground/90" {...props} />
        ),
        li: ({ ...props }) => <li className="text-sm leading-relaxed" {...props} />,
        a: ({ ...props }) => (
          <a className="underline underline-offset-2 hover:text-foreground" target="_blank" rel="noreferrer" {...props} />
        ),
        code: ({ ...props }) => (
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props} />
        ),
        blockquote: ({ ...props }) => (
          <blockquote className="border-l-2 border-border pl-3 italic text-muted-foreground" {...props} />
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
