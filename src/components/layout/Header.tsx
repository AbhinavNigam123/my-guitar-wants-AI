"use client";

// Exact Songsterr nav values from getComputedStyle():
// Nav bg: rgb(32,32,34) = #202022, height 80px
// Logo link: 86×95px, color #238c35, radius "0 0 2px 2px"
// Nav items: height 80px, color #238c35, each has icon 40×50px + label
// Label: 10px / weight 500 / uppercase / letter-spacing 0.3px / color rgb(138,139,140)
// Item widths: Upgrade 130px, Search 73px, My Tabs 81px, New Tab 86px, Help 86px, Sign In 86px

import Image from "next/image";

interface HeaderProps {
  onSearchOpen?: () => void;
}

// Songsterr uses their own SVG sprite for nav icons. We replicate with lucide at same visual size.
// Each item: container 40×50px centred, label below.
function NavItem({
  href,
  label,
  width,
  onClick,
  children,
}: {
  href?: string;
  label: string;
  width: number;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const cls =
    "flex flex-col items-center justify-end h-full pb-0 select-none transition-opacity hover:opacity-70 cursor-pointer";
  const style = { width, color: "#238c35", textDecoration: "none" };

  const inner = (
    <>
      {/* Icon container: 40px wide, 50px tall — matches Songsterr exactly */}
      <div
        className="flex items-center justify-center"
        style={{ width: 40, height: 50 }}
      >
        {children}
      </div>
      {/* Label: 10px, weight 500, uppercase, letter-spacing 0.3px, color #8a8b8c */}
      <span
        style={{
          fontSize: 10,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.3px",
          color: "#8a8b8c",
          lineHeight: "12px",
          paddingBottom: 8,
        }}
      >
        {label}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button onClick={onClick} className={cls} style={style}>
        {inner}
      </button>
    );
  }
  return (
    <a href={href ?? "#"} className={cls} style={style}>
      {inner}
    </a>
  );
}

// SVG icons that match Songsterr's custom icon set visually
function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
function NewTabIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}
function HelpIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function SignInIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}

export default function Header({ onSearchOpen }: HeaderProps) {
  return (
    <nav
      className="shrink-0 flex items-stretch overflow-hidden"
      style={{
        height: 80,
        backgroundColor: "#202022",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      {/* Logo — 86×95px, extends 15px below the 80px nav, green bg, rounded bottom */}
      <a
        href="/practice"
        className="flex flex-col items-center justify-center shrink-0 self-stretch relative"
        style={{
          width: 86,
          // Visually extends below nav by making it taller via negative margin or overflow
          backgroundColor: "#238c35",
          borderRadius: "0 0 4px 4px",
          // The real Songsterr logo block is 95px tall in an 80px nav — it overflows down
          marginBottom: -15,
          paddingBottom: 15,
          zIndex: 1,
        }}
      >
        <Image
          src="/images/songsterr.png"
          alt="Songsterr"
          width={44}
          height={44}
          priority
          className="rounded"
        />
        <span
          style={{
            color: "white",
            fontSize: 11,
            fontWeight: 300,
            marginTop: 4,
            letterSpacing: "0.01em",
          }}
        >
          songsterr
        </span>
      </a>

      {/* Left spacer matching real Songsterr layout (~135px gap before Upgrade) */}
      <div style={{ width: 85 }} />

      {/* Nav items — ordered as Songsterr: Upgrade, Search, My Tabs, New Tab, Help, Sign In */}
      <NavItem href="/plus" label="Upgrade to Plus" width={130}>
        <PlusIcon />
      </NavItem>

      <NavItem label="Search" width={73} onClick={onSearchOpen}>
        <SearchIcon />
      </NavItem>

      <NavItem href="#" label="My Tabs" width={81}>
        <StarIcon />
      </NavItem>

      <NavItem href="#" label="New Tab" width={86}>
        <NewTabIcon />
      </NavItem>

      <NavItem href="#" label="Help" width={86}>
        <HelpIcon />
      </NavItem>

      <div className="flex-1" />

      <NavItem href="#" label="Sign In" width={86}>
        <SignInIcon />
      </NavItem>
    </nav>
  );
}
