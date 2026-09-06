export function MessageBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={
          isUser
            ? "max-w-[75%] rounded-2xl rounded-br-sm bg-lamp/90 text-[#1a1204] px-4 py-2.5 text-[15px] leading-relaxed"
            : "max-w-[75%] rounded-2xl rounded-bl-sm glass px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap"
        }
      >
        {content}
      </div>
    </div>
  );
}
