import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { Vault } from "@/components/vault";

export const Route = createFileRoute("/vault")({
  component: VaultPage,
  errorComponent: ({ error }) => (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 text-sm text-destructive">
        Failed to load vault: {error.message}
      </div>
    </AppLayout>
  ),
  notFoundComponent: () => (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 text-sm text-muted-foreground">Not found.</div>
    </AppLayout>
  ),
});

function VaultPage() {
  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Secrets Vault</h1>
          <p className="text-sm text-muted-foreground">
            Encrypted storage for passwords, API keys, Wi-Fi codes, and other sensitive
            household values. Personal entries are private to you; shared entries are
            visible to all household members (only editors and admins can change them).
          </p>
        </header>
        <Vault />
      </div>
    </AppLayout>
  );
}
