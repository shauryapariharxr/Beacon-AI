"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { Copy, Check } from "lucide-react";
import { BotAvatar } from "./BotAvatar";

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  // Flat, quiet affordance: the code header is chrome, not content, so the
  // button only lifts on hover instead of sitting there in a filled pill.
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 -mr-1.5 text-xs
        text-muted hover:text-ink hover:bg-white/[0.06] transition-colors"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5" /> Copied
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" /> Copy
        </>
      )}
    </button>
  );
}

const codeStyle: Record<string, React.CSSProperties> = {
  "code[class*=\"language-\"]": { background: "transparent", color: "#ffffff", fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace", fontSize: "13px", lineHeight: "1.5", whiteSpace: "pre" },
  "pre[class*=\"language-\"]": { background: "transparent", color: "#ffffff", fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace", fontSize: "13px", lineHeight: "1.5", whiteSpace: "pre", margin: 0, padding: 0, overflow: "auto" },
  comment: { color: "#6a737d", fontStyle: "italic" },
  prolog: { color: "#6a737d" },
  cdata: { color: "#6a737d" },
  doctype: { color: "#ffffff" },
  punctuation: { color: "#9ca3af" },
  entity: { color: "#ffffff" },
  "attr-name": { color: "#f0b068" },
  "class-name": { color: "#f0b068" },
  boolean: { color: "#f0b068" },
  constant: { color: "#f0b068" },
  number: { color: "#f0b068" },
  atrule: { color: "#f0b068" },
  keyword: { color: "#d4a0e8" },
  property: { color: "#f28b8b" },
  tag: { color: "#f28b8b" },
  symbol: { color: "#f28b8b" },
  deleted: { color: "#f28b8b" },
  important: { color: "#f28b8b" },
  selector: { color: "#b8e0a0" },
  string: { color: "#b8e0a0" },
  char: { color: "#b8e0a0" },
  builtin: { color: "#b8e0a0" },
  inserted: { color: "#b8e0a0" },
  regex: { color: "#b8e0a0" },
  "attr-value": { color: "#b8e0a0" },
  variable: { color: "#82c8f0" },
  operator: { color: "#82c8f0" },
  function: { color: "#82c8f0" },
  url: { color: "#7cd8d8" },
};

/**
 * One flat code panel: a quiet header strip (language name, copy action) over
 * a darker code well, split by a hairline rule. Deliberately no traffic-light
 * dots and no nested card — the reply itself is already a bordered panel, and
 * stacking two frames inside it made short answers look like a file manager.
 */
function CodeBlock({ language, children }: { language: string; children: string }) {
  return (
    <div className="my-3 rounded-xl overflow-hidden border border-white/[0.09] bg-black/30">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/[0.07]">
        <span className="text-xs font-mono text-muted truncate">{language}</span>
        <CopyButton code={children} />
      </div>
      <div className="px-4 py-3.5 overflow-x-auto">
        <SyntaxHighlighter
          language={language}
          style={codeStyle}
          customStyle={{
            margin: 0,
            padding: 0,
            background: "transparent",
            fontSize: "13px",
            lineHeight: "1.6",
            borderRadius: 0,
          }}
          wrapLongLines
        >
          {children}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

export function MessageBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end animate-msg-in">
        <div className="max-w-[75%] rounded-[20px] rounded-br-md bg-gradient-to-br from-lamp to-orange-500 text-[#1a1204] px-4 py-2.5 text-[15px] leading-relaxed shadow-[0_2px_12px_rgba(232,163,61,0.15)]">
          {content}
        </div>
      </div>
    );
  }

  // Assistant turns get the bot mark, then a flat outlined panel. Upgrading
  // the old frosted `glass` bubble to a bordered one keeps code blocks and
  // tables from fighting a translucent background, and drops a backdrop-filter
  // per message — which was real compositing cost on a long conversation.
  return (
    <div className="flex justify-start items-start gap-2.5 animate-msg-in">
      <BotAvatar className="mt-0.5" />
      <div className="min-w-0 max-w-[85%] rounded-2xl rounded-tl-md border border-white/[0.10] bg-white/[0.02] px-5 py-4 text-[15px] leading-relaxed">
        <div className="prose prose-invert prose-sm max-w-none
          prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0
          prose-pre:my-0 prose-pre:bg-transparent prose-pre:p-0
          prose-strong:text-white prose-a:text-amber-400 prose-a:no-underline hover:prose-a:underline
          prose-li:marker:text-amber-400">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || "");
                const codeString = String(children).replace(/\n$/, "");

                if (match) {
                  return <CodeBlock language={match[1]} children={codeString} />;
                }

                // Inline code
                return (
                  <code className="bg-white/10 text-amber-300 px-1.5 py-0.5 rounded text-[13px] font-mono" {...props}>
                    {children}
                  </code>
                );
              },
              // Better table styling
              table({ children }) {
                return (
                  <div className="overflow-x-auto my-3">
                    <table className="border-collapse border border-white/10 w-full text-sm">
                      {children}
                    </table>
                  </div>
                );
              },
              th({ children }) {
                return (
                  <th className="border border-white/10 bg-white/5 px-3 py-2 text-left font-medium text-gray-300">
                    {children}
                  </th>
                );
              },
              td({ children }) {
                return (
                  <td className="border border-white/10 px-3 py-2">
                    {children}
                  </td>
                );
              },
              // Better list styling
              ul({ children }) {
                return <ul className="list-disc list-inside space-y-1 my-2">{children}</ul>;
              },
              ol({ children }) {
                return <ol className="list-decimal list-inside space-y-1 my-2">{children}</ol>;
              },
              // Horizontal rule
              hr() {
                return <hr className="border-white/10 my-4" />;
              },
              // Links open in new tab
              a({ href, children }) {
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

