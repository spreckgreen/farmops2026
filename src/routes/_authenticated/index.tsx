import { createFileRoute, redirect } from "@tanstack/react-router";
import { todayDateString } from "@/lib/slug";

export const Route = createFileRoute("/_authenticated/")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/notes/$date", params: { date: todayDateString() } });
  },
});
