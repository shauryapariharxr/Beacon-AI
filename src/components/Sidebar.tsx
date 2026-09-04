"use client";

type Conversation = { id: string; title: string; createdAt: number };

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  userEmail,
  onLogout,
}: {
  conversations: Conversation[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  userEmail: string;
  onLogout: () => void;
}) {
  return (
    <div className="w-64 shrink-0 border-r border-border bg-panel flex flex-col h-full">
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full text-left px-3 py-2 rounded-lg border border-border hover:border-lamp/60 hover:bg-panel2 transition-colors text-sm"
        >
          + New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors ${
              c.id === activeId ? "bg-panel2 text-ink" : "text-muted hover:bg-panel2/60"
            }`}
          >
            {c.title || "Untitled chat"}
          </button>
        ))}
      </div>
      <div className="p-3 border-t border-border flex items-center justify-between">
        <span className="text-xs text-muted truncate">{userEmail}</span>
        <button onClick={onLogout} className="text-xs text-muted hover:text-ink">
          Log out
        </button>
      </div>
    </div>
  );
}
