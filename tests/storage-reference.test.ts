import { describe, expect, it } from "vitest";
import { STORAGE_REFERENCE, storagePath, storageReferenceMatches } from "@/lib/storage-reference";
import { getContainerTemplate } from "@/lib/inventory-containers";

describe("storage reference", () => {
  it("builds normalized hierarchical location codes", () => {
    expect(storagePath(["fs", "r001", "s05", "l"])).toBe("FS-R001-S05-L");
  });

  it("finds container-top subdivisions", () => {
    expect(storageReferenceMatches("TOP-R").some((entry) => entry.group === "container_top")).toBe(true);
    expect(STORAGE_REFERENCE.some((entry) => entry.example === "CASE-0014-TOP-FR")).toBe(true);
  });

  it("adds top subdivisions to stackable toolbox component templates", () => {
    const template = getContainerTemplate("ridgid_stackable_toolbox");
    expect(template?.suggestedCompartments.some((part) => part.code === "TOP")).toBe(true);
    expect(template?.suggestedCompartments.some((part) => part.code === "TOP-R")).toBe(true);
  });
});
