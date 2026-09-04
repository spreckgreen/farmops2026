import { useCallback, useEffect, useState } from "react";
import type { PeerRegistration } from "@/lib/electrical-peer-token";

/**
 * Holds the peer access key for a one-way audit pull.
 *
 * A key is short-lived by policy: it is dropped when the operator clears it,
 * after a successful pull, and when the panel unmounts (leaving the page), so
 * a pasted or generated key never lingers in a mounted screen.
 */
export function usePeerTokenState() {
  const [peerToken, setPeerToken] = useState("");
  const [generatedPeerToken, setGeneratedPeerToken] = useState<PeerRegistration | null>(null);

  const clearPeerToken = useCallback(() => {
    setPeerToken("");
    setGeneratedPeerToken(null);
  }, []);

  useEffect(() => clearPeerToken, [clearPeerToken]);

  return { peerToken, setPeerToken, generatedPeerToken, setGeneratedPeerToken, clearPeerToken };
}
