import { useEffect, useRef, useState } from "react";
import { Download, Share2, X, Maximize2, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Full-screen dark profile photo viewer with close, share, download.
 * Reused from quick-view modal and full profile page.
 */
export function ProfilePhotoViewer({
  open,
  src,
  name,
  subtitle,
  onClose,
}: {
  open: boolean;
  src: string | null | undefined;
  name?: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) setScale(1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !src) return null;

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: name || "Profile photo", url: src });
      }
    } catch {
      /* cancelled */
    }
  };

  const download = () => {
    try {
      const a = document.createElement("a");
      a.href = src;
      a.download = `${(name || "profile").replace(/\s+/g, "_")}.jpg`;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      window.open(src, "_blank");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black/95 text-white animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Profile photo"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 active:bg-white/20"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold text-white/80">Close</span>
        <div className="w-10" />
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col items-center justify-center px-4"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          startY.current = e.touches[0]?.clientY ?? null;
        }}
        onTouchEnd={(e) => {
          const y = e.changedTouches[0]?.clientY;
          if (startY.current != null && y != null && y - startY.current > 120) onClose();
          startY.current = null;
        }}
      >
        <button
          type="button"
          className="max-h-[70vh] w-full max-w-lg overflow-hidden"
          onClick={() => setScale((s) => (s > 1 ? 1 : 1.6))}
        >
          <img
            src={src}
            alt={name || "Profile"}
            className={cn(
              "mx-auto max-h-[70vh] w-auto max-w-full object-contain transition-transform duration-300",
              scale > 1 && "scale-110",
            )}
            style={{ transform: `scale(${scale})` }}
            draggable={false}
          />
        </button>
        {(name || subtitle) && (
          <div className="mt-6 text-center">
            {name ? <p className="text-lg font-bold tracking-tight">{name}</p> : null}
            {subtitle ? <p className="mt-0.5 text-sm text-white/55">{subtitle}</p> : null}
          </div>
        )}
      </div>

      <div
        className="flex items-center justify-around gap-2 px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <Action icon={<Share2 className="h-5 w-5" />} label="Share" onClick={() => void share()} />
        <Action icon={<Download className="h-5 w-5" />} label="Download" onClick={download} />
        <Action icon={<Maximize2 className="h-5 w-5" />} label="View Full" onClick={() => setScale((s) => (s > 1 ? 1 : 1.8))} />
        <Action icon={<MoreHorizontal className="h-5 w-5" />} label="More" onClick={() => void share()} />
      </div>
    </div>
  );
}

function Action({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 text-white/80 active:scale-95 active:text-white"
    >
      <span className="grid h-11 w-11 place-items-center rounded-full bg-white/10">{icon}</span>
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}
