// Reusable "Send to Ghost" button. Posts a {title, html, tags} payload to the
// Ghost Admin API via the `publishToGhost` server function and toasts the
// resulting draft URL.

import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { publishToGhost } from "@/lib/ghost.functions";

type Props = {
  build: () => { title: string; html: string; tags?: string[] } | null;
  status?: "draft" | "published";
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost" | "secondary";
  label?: string;
  disabled?: boolean;
  className?: string;
};

export function SendToGhostButton({
  build,
  status = "draft",
  size = "sm",
  variant = "outline",
  label = "Send to Ghost",
  disabled,
  className,
}: Props) {
  const fn = useServerFn(publishToGhost);
  const m = useMutation({
    mutationFn: (payload: { title: string; html: string; tags?: string[] }) =>
      fn({ data: { ...payload, status } }),
    onSuccess: (res) => {
      if (res.url) {
        toast.success(`Sent to Ghost (${res.status})`, {
          action: { label: "Open", onClick: () => window.open(res.url!, "_blank") },
        });
      } else {
        toast.success(`Sent to Ghost (${res.status})`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Send failed"),
  });

  return (
    <Button
      size={size}
      variant={variant}
      disabled={disabled || m.isPending}
      className={className}
      onClick={() => {
        const payload = build();
        if (!payload) {
          toast.error("Nothing to send yet");
          return;
        }
        m.mutate(payload);
      }}
    >
      <Send className={`h-4 w-4 mr-1.5 ${m.isPending ? "animate-pulse" : ""}`} />
      {m.isPending ? "Sending…" : label}
    </Button>
  );
}
