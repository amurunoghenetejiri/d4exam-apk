import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { friendlyError } from "@/lib/friendly-error";
import { uploadProfilePhoto } from "@/lib/profile-photo-upload";

export function ProfilePhotoButton({
  userId,
  profileId,
  hasPhoto,
}: {
  userId: string;
  profileId?: string | null;
  hasPhoto?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  return (
    <label className="mt-2 inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
      {busy ? "Uploading…" : hasPhoto ? "Change photo" : "Upload photo"}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || !userId) return;
          setBusy(true);
          try {
            await uploadProfilePhoto({ file, userId, profileId });
            toast.success("Profile photo updated");
            void qc.invalidateQueries({ queryKey: ["session-user"] });
            void qc.invalidateQueries({ queryKey: ["public-profile"] });
            void qc.invalidateQueries({ queryKey: ["student-context"] });
          } catch (err) {
            toast.error(friendlyError(err, "Could not upload photo"));
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}
