import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, Send, X, Trash2, Loader2, Bot, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { askConsultant } from "@/lib/consultant.functions";
import { useAiFeatureEnabled } from "@/hooks/use-ai-settings";
import { AiTruncationWarning } from "@/components/ai-truncation-warning";
import type { TruncationSignal } from "@/lib/ai-truncation";

type ChatRole = "user" | "assistant";
interface ChatMessage {
  role: ChatRole;
  content: string;
  ts: number;
}

const HIDDEN_PREFIXES = ["/auth", "/reset-password"];

function detectArea(pathname: string): { key: string; label: string } {
  const p = pathname.toLowerCase();
  if (p.startsWith("/food")) return { key: "food", label: "Food advisor" };
  if (p.startsWith("/maintenance")) return { key: "maintenance", label: "Maintenance advisor" };
  if (p.startsWith("/irrigation") || p.startsWith("/weather"))
    return { key: "irrigation", label: "Irrigation & Weather advisor" };
  if (p.startsWith("/inventory") || p.startsWith("/procedures"))
    return { key: "inventory", label: "Inventory & Procedures advisor" };
  return { key: "general", label: "Farm consultant" };
}

const STORAGE_PREFIX = "farmops.consultant.v1:";

function loadHistory(key: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) ? parsed.slice(-40) : [];
  } catch {
    return [];
  }
}

function saveHistory(key: string, messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify(messages.slice(-40)),
    );
  } catch {
    /* quota / private mode: ignore */
  }
}

export function ConsultantChat() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const area = useMemo(() => detectArea(pathname), [pathname]);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Truncation signal for the latest reply only — it describes that request.
  const [truncation, setTruncation] = useState<TruncationSignal | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ask = useServerFn(askConsultant);

  // Hydrate + swap history when area changes
  useEffect(() => {
    setMessages(loadHistory(area.key));
  }, [area.key]);

  // Persist on change
  useEffect(() => {
    saveHistory(area.key, messages);
  }, [area.key, messages]);

  // Autoscroll on new messages
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, busy]);

  // Focus textarea when opened
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => textareaRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const consultantEnabled = useAiFeatureEnabled("consultant");
  const hidden =
    !consultantEnabled ||
    HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    const userMsg: ChatMessage = { role: "user", content: text, ts: Date.now() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const reply = await ask({
        data: {
          area: area.key,
          path: pathname,
          messages: next.map(({ role, content }) => ({ role, content })),
        },
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply.text || "(no reply)", ts: Date.now() },
      ]);
      setTruncation(reply.truncation ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Consultant failed", { description: message });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ ${message}`,
          ts: Date.now(),
        },
      ]);
    } finally {
      setBusy(false);
      setTimeout(() => textareaRef.current?.focus(), 30);
    }
  }, [ask, area.key, busy, input, messages, pathname]);

  const clear = useCallback(() => {
    setMessages([]);
    setTruncation(null);
    saveHistory(area.key, []);
  }, [area.key]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  if (hidden) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Open farm consultant"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        <MessageCircle className="h-6 w-6" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
          <SheetHeader className="flex-row items-center justify-between space-y-0 border-b px-4 py-3">
            <div>
              <SheetTitle className="text-base">{area.label}</SheetTitle>
              <SheetDescription className="text-xs">
                Context-aware · sees your farm snapshot
              </SheetDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={clear}
                aria-label="Clear conversation"
                title="Clear conversation"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </SheetHeader>

          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
          >
            {messages.length === 0 && (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  Ask about {area.label.toLowerCase()}.
                </p>
                <ul className="mt-2 list-inside list-disc space-y-1">
                  <li>"What's due for maintenance in the next 30 days?"</li>
                  <li>"Which pantry items expire soonest?"</li>
                  <li>"Should I run irrigation tomorrow?"</li>
                  <li>"Best way to preserve today's harvest?"</li>
                </ul>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {m.role === "user" ? (
                    <UserIcon className="h-4 w-4" />
                  ) : (
                    <Bot className="h-4 w-4" />
                  )}
                </div>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking…
              </div>
            )}
          </div>

          <div className="border-t p-3">
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={`Ask about ${area.label.toLowerCase()}…`}
                rows={2}
                className="min-h-[48px] resize-none"
                disabled={busy}
              />
              <Button
                type="button"
                size="icon"
                onClick={() => void send()}
                disabled={busy || !input.trim()}
                aria-label="Send"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Conversation stays in this browser · Enter to send · Shift+Enter for newline
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
