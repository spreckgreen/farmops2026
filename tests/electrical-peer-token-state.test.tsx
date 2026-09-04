import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePeerTokenState } from "@/components/electrical/use-peer-token-state";
import { buildPeerRegistration, generatePeerToken } from "@/lib/electrical-peer-token";

describe("peer token lifetime", () => {
  it("clears the pasted key and the generated registration together", async () => {
    const { result } = renderHook(() => usePeerTokenState());
    const token = generatePeerToken();
    const registration = await buildPeerRegistration(token);
    act(() => {
      result.current.setPeerToken(token);
      result.current.setGeneratedPeerToken(registration);
    });
    expect(result.current.peerToken).toBe(token);
    expect(result.current.generatedPeerToken).not.toBeNull();

    act(() => result.current.clearPeerToken());
    expect(result.current.peerToken).toBe("");
    expect(result.current.generatedPeerToken).toBeNull();
  });

  it("drops the key when the panel unmounts (leaving the page)", async () => {
    const { result, unmount } = renderHook(() => usePeerTokenState());
    act(() => result.current.setPeerToken(generatePeerToken()));
    expect(result.current.peerToken).not.toBe("");
    unmount();
    const { result: fresh } = renderHook(() => usePeerTokenState());
    expect(fresh.current.peerToken).toBe("");
    expect(fresh.current.generatedPeerToken).toBeNull();
  });
});
