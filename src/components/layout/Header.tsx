"use client";

import Image from "next/image";
import { Search, Plus, Star, FileText, HelpCircle, LogIn } from "lucide-react";
import { useState } from "react";

// Exact Songsterr colors extracted via CDP:
// Nav bg: rgb(32, 32, 34) = #202022
// Nav icon/text: rgb(35, 140, 53) = #238c35
// Nav height: 80px
// Logo block: 86×95px, border-radius: 0 0 2px 2px

const NAV_ITEMS = [
  { label: "New tab", icon: Plus,       tip: "Ctrl+T" },
  { label: "Search",  icon: Search,     tip: "Ctrl+K" },
  { label: "My tabs", icon: Star,       tip: "" },
  { label: "New tab", icon: FileText,   tip: "" },
  { label: "Help",    icon: HelpCircle, tip: "Ctrl+K" },
  { label: "Sign In", icon: LogIn,      tip: "" },
];

export default function Header() {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    // height 80px, bg #202022, sticky top
    <nav
      className="shrink-0 sticky top-0 z-50 flex items-end"
      style={{ height: 80, backgroundColor: "#202022" }}
    >
      {/* Logo block — 86×95px, overlaps the 80px nav by 15px, rounded bottom corners */}
      <a
        href="/practice"
        className="flex flex-col items-center justify-end pb-2 shrink-0 self-stretch"
        style={{
          width: 86,
          backgroundColor: "#238c35",
          borderRadius: "0 0 2px 2px",
          // sits flush at top, extends 15px below nav baseline
        }}
      >
        <Image
          src="/images/songsterr.png"
          alt="Songsterr"
          width={50}
          height={50}
          className="rounded-sm"
          priority
        />
        <span
          className="text-white text-[11px] font-light mt-1 tracking-wide"
          style={{ fontWeight: 300 }}
        >
          songsterr
        </span>
      </a>

      {/* Nav items — icon + label stacked, color #238c35 */}
      <div className="flex items-end h-full flex-1">
        {NAV_ITEMS.map(({ label, icon: Icon }, i) => (
          <button
            key={i}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            className="flex flex-col items-center justify-end pb-3 transition-opacity"
            style={{
              width: i === 0 ? 86 : 60,
              color: "#238c35",
              opacity: hoveredIdx === i ? 0.75 : 1,
            }}
          >
            <Icon
              strokeWidth={1.5}
              style={{ width: 20, height: 20, color: "#238c35" }}
            />
            <span
              className="mt-1 text-[10px] leading-none"
              style={{ color: "#238c35", fontWeight: 300 }}
            >
              {label}
            </span>
          </button>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Upgrade to Plus — right side, green text */}
        <a
          href="#"
          className="flex flex-col items-center justify-end pb-3 transition-opacity hover:opacity-75"
          style={{ width: 130, color: "#238c35" }}
        >
          <span
            className="text-[13px]"
            style={{ color: "#238c35", fontWeight: 300 }}
          >
            Upgrade to Plus
          </span>
        </a>
      </div>
    </nav>
  );
}
