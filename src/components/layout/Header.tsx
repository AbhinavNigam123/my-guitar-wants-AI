"use client";

// Songsterr dark-mode CSS tokens (from real stylesheet):
// --topbar-surface-dark:        #202022
// --topbar-border-dark:         #3c3b40
// --topbar-item-content-dark:   #75787c   (icon + label color)
// --topbar-item-hover-dark:     #adafb2
// --topbar-item-chosen-dark:    #e7e7e7
// --topbar-plus-icon-dark:      #238c35   (Upgrade+ icon)
// --logo-bg:  linear-gradient(140.99deg, #42b8fb 0%, #5376f0 99.48%)  ← blue/purple
// --logo-main-color: #fff
// Nav height: 80px; logo block: 86×95px

import Image from "next/image";

interface HeaderProps {
  onSearchOpen?: () => void;
}

function NavItem({
  href,
  label,
  width,
  onClick,
  isPlus,
  children,
}: {
  href?: string;
  label: string;
  width: number;
  onClick?: () => void;
  isPlus?: boolean;
  children: React.ReactNode;
}) {
  // chosen (active) color for plus icon: #238c35; rest: #75787c
  const iconColor = isPlus ? "#238c35" : "#75787c";

  const inner = (
    <>
      <div className="flex items-center justify-center" style={{ width: 40, height: 50 }}>
        <span style={{ color: iconColor }}>{children}</span>
      </div>
      <span style={{
        fontSize: 10,
        fontWeight: 500,
        textTransform: "uppercase" as const,
        letterSpacing: "0.3px",
        color: isPlus ? "#238c35" : "#75787c",
        lineHeight: "12px",
        paddingBottom: 8,
      }}>
        {label}
      </span>
    </>
  );

  const baseStyle: React.CSSProperties = {
    width,
    textDecoration: "none",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    height: "100%",
    padding: 0,
    transition: "opacity 0.15s",
  };

  if (onClick) {
    return (
      <button
        onClick={onClick}
        style={baseStyle}
        onMouseEnter={e => {
          (e.currentTarget.querySelectorAll("*") as NodeListOf<HTMLElement>)
            .forEach(el => { if (!isPlus) el.style.color = "#adafb2"; });
        }}
        onMouseLeave={e => {
          (e.currentTarget.querySelectorAll("*") as NodeListOf<HTMLElement>)
            .forEach(el => { if (!isPlus) el.style.color = "#75787c"; });
        }}
      >
        {inner}
      </button>
    );
  }

  return (
    <a
      href={href ?? "#"}
      style={baseStyle}
      onMouseEnter={e => {
        (e.currentTarget.querySelectorAll("*") as NodeListOf<HTMLElement>)
          .forEach(el => { if (!isPlus) el.style.color = "#adafb2"; });
      }}
      onMouseLeave={e => {
        (e.currentTarget.querySelectorAll("*") as NodeListOf<HTMLElement>)
          .forEach(el => { if (!isPlus) el.style.color = "#75787c"; });
      }}
    >
      {inner}
    </a>
  );
}

// SVG icons matching Songsterr's icon set style (thin stroke, 24px)
const PlusIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const SearchIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const StarIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);
const NewTabIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
  </svg>
);
const HelpIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <circle cx="12" cy="17" r="0.5" fill="currentColor" />
  </svg>
);
const SignInIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <polyline points="10 17 15 12 10 7" />
    <line x1="15" y1="12" x2="3" y2="12" />
  </svg>
);

export default function Header({ onSearchOpen }: HeaderProps) {
  return (
    <nav
      style={{
        height: 80,
        backgroundColor: "#202022",
        borderBottom: "1px solid #3c3b40",
        display: "flex",
        alignItems: "stretch",
        flexShrink: 0,
        position: "sticky",
        top: 0,
        zIndex: 50,
        overflow: "visible",
      }}
    >
      {/* Logo — 86×95px, blue-purple gradient, overflows 15px below nav */}
      <a
        href="/practice"
        style={{
          width: 86,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          textDecoration: "none",
          // Real Songsterr logo gradient: linear-gradient(140.99deg, #42b8fb 0%, #5376f0 99.48%)
          background: "linear-gradient(140.99deg, #42b8fb 0%, #5376f0 99.48%)",
          borderRadius: "0 0 4px 4px",
          marginBottom: -15,
          paddingBottom: 15,
          alignSelf: "stretch",
        }}
      >
        <Image src="/images/songsterr.png" alt="Songsterr" width={44} height={44} priority />
        <span style={{ color: "white", fontSize: 11, fontWeight: 300, marginTop: 3 }}>
          songsterr
        </span>
      </a>

      {/* Gap matching real Songsterr left offset */}
      <div style={{ width: 85, flexShrink: 0 }} />

      {/* Upgrade to Plus — uses plus-specific green */}
      <NavItem href="/plus" label="Upgrade to Plus" width={130} isPlus>
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

      <div style={{ flex: 1 }} />

      <NavItem href="#" label="Sign In" width={86}>
        <SignInIcon />
      </NavItem>
    </nav>
  );
}
