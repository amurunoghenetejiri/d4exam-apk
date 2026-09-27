#!/usr/bin/env python3
"""Apply D4EXAM messaging UX fixes in-place."""
from pathlib import Path

def main():
    mm = Path("src/components/messaging/MessageMedia.tsx")
    t = mm.read_text(encoding="utf-8")

    if "export function stopAllVoices" not in t:
        t = t.replace(
            "function onVoiceEnded(id: string) {",
            (
                "export function stopAllVoices() {\n"
                "  if (activeVoiceId) {\n"
                "    voiceMap.get(activeVoiceId)?.pause();\n"
                "    activeVoiceId = null;\n"
                "  }\n"
                "  for (const [, reg] of voiceMap) {\n"
                "    try { reg.pause(); } catch { /* ignore */ }\n"
                "  }\n"
                "}\n\n"
                "function onVoiceEnded(id: string) {"
            ),
        )
        print("stopAllVoices")

    old_time = (
        "  const effectiveDur = dur > 0 ? dur : (durationSec != null && durationSec > 0 ? durationSec : 0);\n"
        "  const timeShown = effectiveDur > 0 ? fmtDur(effectiveDur) : (playing ? fmtDur(cur) : \"0:00\");"
    )
    new_time = (
        "  const effectiveDur = dur > 0 ? dur : (durationSec != null && durationSec > 0 ? durationSec : 0);\n"
        "  const timeShown = playing\n"
        "    ? fmtDur(cur)\n"
        "    : (effectiveDur > 0 ? fmtDur(effectiveDur) : \"0:00\");"
    )
    if old_time in t:
        t = t.replace(old_time, new_time)
        print("voice elapsed timer")

    t = t.replace(
        "progress={dur > 0 ? cur / dur : 0}",
        "progress={effectiveDur > 0 ? Math.min(1, cur / effectiveDur) : 0}",
    )

    # Allow swipe on voice bubble (seek still stops in WaveBars)
    t = t.replace(
        "      onTouchStart={(e) => e.stopPropagation()}\n"
        "      onTouchMove={(e) => e.stopPropagation()}\n"
        "    >",
        "    >",
        1,
    )

    mm.write_text(t, encoding="utf-8")
    print("MessageMedia ok")

    sc = Path("src/routes/student.contact-officer.tsx")
    s = sc.read_text(encoding="utf-8")

    if "stopAllVoices" not in s:
        s = s.replace(
            'parseOfficerReply } from "@/components/messaging/MessageMedia";',
            'parseOfficerReply, stopAllVoices } from "@/components/messaging/MessageMedia";',
        )

    s = s.replace(
        '"mb-0.5 grid h-14 w-14 place-items-center rounded-full shadow-xl transition active:scale-95",\n'
        '                "bg-gradient-to-b from-[#60a5fa] via-[#3b82f6] to-[#1d4ed8] text-white",\n'
        '                "ring-[3px] ring-white/70 ring-offset-2 ring-offset-[#0b1b3a]",',
        '"mb-0.5 grid h-11 w-11 place-items-center rounded-full shadow-lg transition active:scale-95",\n'
        '                "bg-gradient-to-b from-[#60a5fa] via-[#3b82f6] to-[#1d4ed8] text-white",\n'
        '                "ring-2 ring-white/60 ring-offset-1 ring-offset-[#0b1b3a]",',
    )
    s = s.replace('<Mic className="h-7 w-7 stroke-[2.5]" />', '<Mic className="h-5 w-5 stroke-[2.25]" />')

    if "stopAllVoices()" not in s:
        s = s.replace(
            "async function startRec() {\n    if (recording) return;\n    try {",
            "async function startRec() {\n    if (recording) return;\n    try {\n      try { stopAllVoices(); } catch { /* ignore */ }",
        )

    s = s.replace(
        'const swipeRef = useRef<{ key: string; id: string; x: number; y: number; axis: "none" | "h" | "v"; side: "in" | "out" } | null>(null);',
        'const swipeRef = useRef<{ key: string; id: string; x: number; y: number; axis: "none" | "h" | "v"; side: "in" | "out"; dx: number } | null>(null);',
    )

    old_swipe = (
        "if (s.axis === \"v\") return; // allow normal vertical scroll\n"
        "                  // Incoming: swipe right; own: swipe left (or either direction)\n"
        "                  let next = 0;\n"
        "                  if (m.side === \"out\") {\n"
        "                    next = Math.max(-72, Math.min(0, rawX));\n"
        "                  } else {\n"
        "                    next = Math.min(72, Math.max(0, rawX));\n"
        "                  }\n"
        "                  setSwipeDx((prev) => (prev[m.key] === next ? prev : { ...prev, [m.key]: next }));\n"
        "                }}\n"
        "                onTouchEnd={() => {\n"
        "                  endLP();\n"
        "                  const s = swipeRef.current;\n"
        "                  const finalDx = swipeDx[m.key] || 0;"
    )
    new_swipe = (
        "if (s.axis === \"v\") return;\n"
        "                  const next = Math.max(-80, Math.min(80, rawX));\n"
        "                  s.dx = next;\n"
        "                  setSwipeDx((prev) => (prev[m.key] === next ? prev : { ...prev, [m.key]: next }));\n"
        "                  try { e.preventDefault(); } catch { /* ignore */ }\n"
        "                }}\n"
        "                onTouchEnd={() => {\n"
        "                  endLP();\n"
        "                  const s = swipeRef.current;\n"
        "                  const finalDx = s?.dx ?? swipeDx[m.key] ?? 0;"
    )
    if old_swipe in s:
        s = s.replace(old_swipe, new_swipe)
        print("swipe bidirectional + ref dx")
    else:
        print("WARN: swipe pattern missing")

    s = s.replace(
        '                    axis: "none",\n'
        '                    side: m.side,\n'
        '                  };',
        '                    axis: "none",\n'
        '                    side: m.side,\n'
        '                    dx: 0,\n'
        '                  };',
    )

    # Remove voice stopPropagation wrapper
    s = s.replace(
        "                  <div\n"
        "                    onTouchStart={(e) => e.stopPropagation()}\n"
        "                    onTouchMove={(e) => e.stopPropagation()}\n"
        "                    onPointerDown={(e) => e.stopPropagation()}\n"
        "                  >\n"
        "                    <VoiceBubble id={`msg-${m.key}`} src={m.attachment_url!} mine={m.side === \"out\"} timeLabel={formatTime(m.at)} tick={m.side === \"out\" ? outTick : \"none\"} durationSec={m.durationSec} />\n"
        "                  </div>",
        "                  <VoiceBubble id={`msg-${m.key}`} src={m.attachment_url!} mine={m.side === \"out\"} timeLabel={formatTime(m.at)} tick={m.side === \"out\" ? outTick : \"none\"} durationSec={m.durationSec} />",
    )

    old_scroll = (
        'className="absolute bottom-[5.25rem] lg:bottom-28 right-4 lg:right-8 z-30 flex items-center gap-1.5 rounded-full bg-[#0b1b3a] px-3.5 py-2.5 lg:px-4 lg:py-3 text-xs lg:text-sm font-bold text-white shadow-xl ring-2 ring-blue-400/50 animate-pulse"\n'
        '        >\n'
        '          <span className="text-base leading-none" aria-hidden>↓</span>'
    )
    new_scroll = (
        'className="absolute bottom-[5.25rem] lg:bottom-28 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gradient-to-b from-[#60a5fa] via-[#3b82f6] to-[#1d4ed8] px-4 py-2.5 lg:px-5 lg:py-3 text-xs lg:text-sm font-bold text-white shadow-xl ring-2 ring-white/50"\n'
        '        >\n'
        '          <span className="inline-block text-lg font-black leading-none" aria-hidden style={{ animation: "d4ScrollArrowBounce 1.05s ease-in-out infinite" }}>↓</span>\n'
        '          <style>{`@keyframes d4ScrollArrowBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(5px); } }`}</style>'
    )
    if old_scroll in s:
        s = s.replace(old_scroll, new_scroll)
        print("scroll centered")
    else:
        print("WARN: scroll pattern missing")

    sc.write_text(s, encoding="utf-8")
    print("student.contact-officer ok")
    print("DONE")

if __name__ == "__main__":
    main()
