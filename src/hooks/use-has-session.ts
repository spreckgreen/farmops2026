// Shared session probe so authenticated server functions are never called
// before a Supabase session exists (which throws
// "Unauthorized: No authorization header provided" and blanks the screen).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** True once we know a Supabase session exists in this browser. */
export function useHasSession() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setHasSession(Boolean(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(Boolean(session));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return hasSession;
}
