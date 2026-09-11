"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
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
      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px]
        bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white transition-all"
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

function CodeBlock({ language, children }: { language: string; children: string }) {
  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border border-white/10 bg-[#1e1e2e]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#181825] border-b border-white/10">
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{language}</span>
        <CopyButton code={children} />
      </div>
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: "0.75rem",
          background: "transparent",
          fontSize: "13px",
          lineHeight: "1.5",
          borderRadius: 0,
        }}
        wrapLongLines
      >
        {children}
      </SyntaxHighlighter>
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
