// Per-row photo evidence for a House panel field observation.
//
// The photo is the primary evidence behind an observed value, so it is stored
// with the row rather than described in free text. Files live in the private
// "field-observations" bucket under the owner's user id folder; the row keeps
// only the storage path plus enough metadata to identify the file later.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Eye, Link2, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export const OBSERVATION_PHOTO_BUCKET = "field-observations";

/**
 * Evidence can live in this project's private storage bucket, or stay in the
 * team's own document store (OneDrive / Google Drive) and be referenced by
 * link. Link evidence keeps the same row shape: `bucket` carries the sentinel
 * source and `path` carries the URL, so nothing downstream needs new columns.
 */
export const ONEDRIVE_PHOTO_BUCKET = "onedrive-link";
export const GOOGLE_DRIVE_PHOTO_BUCKET = "google-drive-link";

export function isLinkedPhotoBucket(bucket: string | null | undefined) {
  return bucket === ONEDRIVE_PHOTO_BUCKET || bucket === GOOGLE_DRIVE_PHOTO_BUCKET;
}

export interface ObservationPhoto {
  bucket: string;
  path: string;
  name: string;
  mime: string;
  size: number;
}

const MAX_BYTES = 15 * 1024 * 1024;

function safeName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "photo").slice(-80);
}

/**
 * Recognises the share-link hosts we support, e.g.
 *  - https://1drv.ms/i/s!AbCdEf...              (OneDrive personal)
 *  - https://contoso-my.sharepoint.com/:i:/g/...(OneDrive for Business)
 *  - https://drive.google.com/file/d/1AbC.../view
 * Returns the sentinel bucket, or null when the host is not one of those.
 */
export function classifyPhotoLink(raw: string): { bucket: string; label: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "1drv.ms" || host.endsWith("sharepoint.com") || host === "onedrive.live.com") {
    return { bucket: ONEDRIVE_PHOTO_BUCKET, label: "OneDrive" };
  }
  if (host === "drive.google.com" || host === "docs.google.com" || host === "drive.usercontent.google.com") {
    return { bucket: GOOGLE_DRIVE_PHOTO_BUCKET, label: "Google Drive" };
  }
  return null;
}

export function ObservationPhotoCell({
  photo,
  onChange,
  disabled,
}: {
  photo: ObservationPhoto | null;
  onChange: (photo: ObservationPhoto | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const linked = isLinkedPhotoBucket(photo?.bucket);

  function attachLink() {
    const kind = classifyPhotoLink(linkUrl);
    if (!kind) {
      toast.error(
        "Paste an https share link from OneDrive (1drv.ms, *.sharepoint.com) or Google Drive (drive.google.com).",
      );
      return;
    }
    onChange({
      bucket: kind.bucket,
      path: linkUrl.trim(),
      name: linkName.trim() || `${kind.label} photo`,
      mime: "",
      size: 0,
    });
    setLinkOpen(false);
    setLinkUrl("");
    setLinkName("");
    toast.success(`${kind.label} link recorded as evidence for this row.`);
  }

  function linkPopover(trigger: React.ReactNode) {
    return (
      <Popover open={linkOpen} onOpenChange={setLinkOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-2">
          <div className="text-sm font-medium">Link a cloud photo</div>
          <p className="text-xs text-muted-foreground">
            Use a share link instead of uploading. Supported: OneDrive (1drv.ms,
            your-tenant.sharepoint.com) and Google Drive (drive.google.com). Make sure the link is
            viewable by whoever needs the evidence.
          </p>
          <Input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://drive.google.com/file/d/1AbC.../view"
          />
          <Input
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
            placeholder="Label (e.g. PNL-H1 directory photo)"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!linkUrl.trim()} onClick={attachLink}>
              Save link
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }


  async function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Attach an image file (JPEG, PNG, HEIC exported as JPEG, etc.).");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("That photo is larger than 15MB. Attach a smaller export.");
      return;
    }
    setBusy(true);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in again before attaching photos.");
      const path = `${auth.user.id}/${crypto.randomUUID()}-${safeName(file.name)}`;
      const { error } = await supabase.storage
        .from(OBSERVATION_PHOTO_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(error.message);
      // Replace, not orphan: the previous file is removed once the new one lands.
      if (photo?.path) {
        await supabase.storage.from(OBSERVATION_PHOTO_BUCKET).remove([photo.path]);
      }
      onChange({
        bucket: OBSERVATION_PHOTO_BUCKET,
        path,
        name: file.name,
        mime: file.type,
        size: file.size,
      });
      toast.success("Photo attached to this evidence row.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not upload that photo.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function view() {
    if (!photo) return;
    if (isLinkedPhotoBucket(photo.bucket)) {
      window.open(photo.path, "_blank", "noopener,noreferrer");
      return;
    }
    const { data, error } = await supabase.storage
      .from(OBSERVATION_PHOTO_BUCKET)
      .createSignedUrl(photo.path, 300);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Could not open that photo.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function remove() {
    if (!photo) return;
    // A link is only a reference: dropping it must never touch the cloud file.
    if (isLinkedPhotoBucket(photo.bucket)) {
      onChange(null);
      return;
    }
    setBusy(true);
    const { error } = await supabase.storage.from(OBSERVATION_PHOTO_BUCKET).remove([photo.path]);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {photo ? (
        <>
          <div className="max-w-[9rem] truncate text-xs" title={photo.path}>
            {linked ? (
              <span className="inline-flex items-center gap-1">
                <Link2 className="h-3 w-3 shrink-0" />
                {photo.name}
              </span>
            ) : (
              photo.name
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => void view()}>
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1"
              disabled={busy || disabled}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </Button>
            {linkPopover(
              <Button size="sm" variant="ghost" className="h-6 px-1" disabled={busy || disabled}>
                <Link2 className="h-3.5 w-3.5" />
              </Button>,
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1"
              disabled={busy || disabled}
              onClick={() => void remove()}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            disabled={busy || disabled}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            Photo
          </Button>
          {linkPopover(
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs"
              disabled={busy || disabled}
              title="Link a OneDrive or Google Drive photo"
            >
              <Link2 className="h-3.5 w-3.5" />
              Link
            </Button>,
          )}
        </div>
      )}
    </div>
  );
}
