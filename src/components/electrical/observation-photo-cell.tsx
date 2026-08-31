// Per-row photo evidence for a House panel field observation.
//
// The photo is the primary evidence behind an observed value, so it is stored
// with the row rather than described in free text. Files live in the private
// "field-observations" bucket under the owner's user id folder; the row keeps
// only the storage path plus enough metadata to identify the file later.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Eye, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const OBSERVATION_PHOTO_BUCKET = "field-observations";

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
          <div className="max-w-[9rem] truncate text-xs" title={photo.name}>
            {photo.name}
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
      )}
    </div>
  );
}
