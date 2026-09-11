"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { Copy, Check } from "lucide-react";

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px]
        bg-white/[0.06] hover:bg-white/[0.12] text-gray-400 hover:text-white transition-all"
    >
      {copied ? (
        <>
          <Check className="w-3 h-3" /> Copied
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" /> Copy
        </>
      )}
    </button>
  );
}

const codeStyle: Record<string, React.CSSProperties> = {
  "code[class*=\"language-\"]": { background: "transparent", color: "#ffffff", fontFamily: "'Fira Code', 'Fira Mono', Menlo, Consolas, monospace", fontSize: "13px", lineHeight: "1.5", whiteSpace: "pre" },
  "pre[class*=\"language-\"]": { background: "transparent", color: "#ffffff", fontFamily: "'Fira Code', 'Fira Mono', Menlo, Consolas, monospace", fontSize: "13px", lineHeight: "1.5", whiteSpace: "pre", margin: 0, padding: 0, overflow: "auto" },
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

function CodeBlock({ language, children }: { language: string; children: string }) {
  return (
    <div className="relative group my-3 rounded-2xl overflow-hidden
      bg-white/[0.04] backdrop-blur-xl
      border border-white/[0.08]
      shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      {/* Outer glass shell — header lives here */}
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57] opacity-80" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] opacity-80" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#28c840] opacity-80" />
          </div>
          <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide ml-1">{language}</span>
        </div>
        <CopyButton code={children} />
      </div>
      {/* Inner dark code area */}
      <div className="mx-4 mb-4 rounded-xl bg-black/40 border border-white/[0.06] px-5 py-4 overflow-x-auto">
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
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-lamp/90 text-[#1a1204] px-4 py-2.5 text-[15px] leading-relaxed">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm glass px-4 py-3 text-[15px] leading-relaxed">
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
