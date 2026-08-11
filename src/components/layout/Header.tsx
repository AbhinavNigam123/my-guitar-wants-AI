"use client";

import { useTheme } from "@/components/theme/ThemeProvider";

// CSS values verified against reference.css and Songsterr:
// topbar-surface-dark/light, topbar-border-dark/light, topbar-item-content, topbar-item-hover

interface HeaderProps {
  onSearchOpen?: () => void;
}

// ── Nav item ─────────────────────────────────────────────────────────────
function NavItem({
  href,
  label,
  onClick,
  wide,
  children,
}: {
  href?: string;
  label: string;
  onClick?: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const inner = (
    <>
      <div style={{
        width: 40, height: 28,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--ss-topbar-item)",
      }}>
        {children}
      </div>
      <div style={{
        fontSize: 12,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.3px",
        color: "var(--ss-topbar-item)",
        marginTop: -3,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textAlign: "center",
        maxWidth: wide ? 120 : 86,
      }}>
        {label}
      </div>
    </>
  );

  const baseStyle: React.CSSProperties = {
    minWidth: 86,
    height: "100%",
    padding: "9px 6px",
    textDecoration: "none",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  };

  const handleEnter = (el: HTMLElement) => {
    el.querySelectorAll<HTMLElement>("div, span").forEach(c => {
      c.style.color = "var(--ss-topbar-item-hover)";
    });
  };
  const handleLeave = (el: HTMLElement) => {
    el.querySelectorAll<HTMLElement>("div, span").forEach(c => {
      c.style.color = "var(--ss-topbar-item)";
    });
  };

  if (onClick) {
    return (
      <button style={baseStyle}
        onClick={onClick}
        onMouseEnter={e => handleEnter(e.currentTarget)}
        onMouseLeave={e => handleLeave(e.currentTarget)}
      >{inner}</button>
    );
  }
  return (
    <a href={href ?? "#"} style={baseStyle}
      onMouseEnter={e => handleEnter(e.currentTarget)}
      onMouseLeave={e => handleLeave(e.currentTarget)}
    >{inner}</a>
  );
}

// ── SVG icons (24px, thin stroke, matching topbar style) ─────────────────
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
const InboxIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);
const ProfileIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

/** Songsterr Appearance icons (icons-sprite #light / #dark) */
const LightThemeIcon = () => (
  <svg width="25" height="25" viewBox="0 0 25 25" fill="currentColor" aria-hidden>
    <path fillRule="evenodd" clipRule="evenodd" d="M12.5 3c.33 0 .59.26.59.59v2.14c0 .32-.26.58-.59.58s-.59-.26-.59-.58V3.59c0-.33.26-.59.59-.59m.17 4.89c-2.54 0-4.6 2.03-4.6 4.53s2.06 4.53 4.6 4.53 4.59-2.03 4.59-4.53-2.05-4.53-4.59-4.53m-5.78 4.53c0-3.15 2.59-5.7 5.78-5.7s5.78 2.55 5.78 5.7-2.59 5.7-5.78 5.7-5.78-2.55-5.78-5.7M19.66 6.6c.24-.21.26-.59.04-.82a.6.6 0 0 0-.84-.04l-1.61 1.44c-.24.22-.25.59-.03.83s.59.25.84.04zM5.59 5.78c-.22.23-.2.61.04.82l1.61 1.45c.24.21.61.2.84-.04.22-.24.2-.61-.04-.83L6.43 5.74a.6.6 0 0 0-.84.04m14.07 12.43c.24.22.26.59.04.83s-.6.26-.84.04l-1.61-1.45a.573.573 0 0 1-.03-.82c.22-.24.59-.26.84-.04zm-14.07.83c-.22-.24-.2-.61.04-.83l1.61-1.44c.24-.22.61-.2.84.04.22.24.2.61-.04.82l-1.61 1.45c-.24.22-.61.2-.84-.04m7.5.23c0-.32-.26-.58-.59-.58s-.59.26-.59.58v2.14c0 .33.26.59.59.59s.59-.26.59-.59zm6.05-7.13c0-.32.27-.58.6-.58h2.17c.32 0 .59.26.59.58 0 .33-.27.59-.59.59h-2.17c-.33 0-.6-.26-.6-.59m-16.05-.58c-.32 0-.59.26-.59.58 0 .33.27.59.59.59h2.17c.33 0 .6-.26.6-.59 0-.32-.27-.58-.6-.58z" />
  </svg>
);

const DarkThemeIcon = () => (
  <svg width="25" height="25" viewBox="0 0 25 25" fill="currentColor" aria-hidden>
    <path fillRule="evenodd" clipRule="evenodd" d="M10.36 4.41c-.08-.45-.68-.56-.93-.17l-.46.74-.95-.13a.502.502 0 0 0-.43.84l.63.66-.46.77c-.25.4.15.89.6.72l.85-.3.66.63c.33.32.89.05.85-.41l-.08-.92.77-.36c.42-.2.37-.8-.07-.93l-.83-.25zm-.81 1.15.15-.24.05.3c.03.19.17.34.35.39l.25.08-.25.11c-.19.09-.3.29-.28.5l.03.34-.22-.21a.52.52 0 0 0-.52-.11l-.22.08.14-.23a.5.5 0 0 0-.07-.6l-.2-.22.29.04c.2.03.39-.06.5-.23m9.9.25c-2.61-1.23-5.64.02-7.52 2.19-1.92 2.2-2.83 5.51-1.1 8.69 1.28 2.35 3.08 3.59 4.96 4.04 1.87.44 3.77.1 5.29-.58 1.04-.48 1.87-1.21 2.44-1.84.28-.31.51-.61.67-.85.08-.11.14-.22.19-.32.02-.04.05-.1.07-.15.01-.03.05-.14.05-.26 0-.21-.1-.36-.18-.45-.08-.08-.16-.12-.21-.15-.1-.04-.2-.07-.28-.09-.14-.03-.32-.06-.51-.1l-.08-.01c-.46-.08-1.06-.18-1.69-.39-1.27-.4-2.62-1.17-3.25-2.77-.47-1.19-.36-2.46 0-3.58s.95-2.02 1.33-2.4c.33-.35.14-.82-.18-.98m-7.56 10.31c-1.44-2.65-.71-5.43.95-7.34 1.48-1.7 3.57-2.57 5.37-2.14a8.8 8.8 0 0 0-1.06 2.19c-.42 1.28-.59 2.85.02 4.38.83 2.07 2.57 3.01 4.01 3.47.68.22 1.32.34 1.78.42-.09.13-.21.27-.34.41-.5.55-1.2 1.16-2.04 1.54-1.33.61-2.95.88-4.5.51-1.54-.37-3.06-1.37-4.19-3.44M4.33 8.1c-.17-.43-.79-.42-.94.01l-.59 1.6-1.83.14c-.48.03-.64.64-.25.91l1.48 1.03-.58 1.67c-.15.45.34.84.74.59l1.5-.93 1.5.94c.4.24.89-.13.75-.57l-.53-1.74 1.34-1a.5.5 0 0 0-.26-.9l-1.68-.14zm-.84 2.07.38-1.04.43 1.05c.07.18.23.3.42.31l1.08.09-.88.66c-.17.13-.24.34-.18.55l.36 1.16-.98-.61c-.16-.1-.37-.1-.53 0l-.93.58.38-1.08a.52.52 0 0 0-.19-.58l-.98-.68 1.18-.09c.2-.01.37-.14.44-.32m3.8 6.24c.15-.44.77-.44.94-.02l.44 1.11 1.15.09a.5.5 0 0 1 .26.9l-.91.68.36 1.18c.14.44-.35.82-.74.57l-1.04-.64-1.01.63c-.41.25-.9-.14-.75-.58l.4-1.13-1.01-.7c-.39-.27-.22-.87.25-.91l1.25-.09zm.48 1.01-.19.53c-.07.19-.24.31-.44.33l-.61.04.51.35c.18.13.26.36.18.57l-.19.55.46-.28c.16-.11.37-.11.53 0l.51.31-.19-.62a.49.49 0 0 1 .18-.54l.44-.34-.54-.04a.52.52 0 0 1-.43-.31z" />
  </svg>
);

// ── Header component ──────────────────────────────────────────────────────
export default function Header({ onSearchOpen }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <header style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 111,
      height: 80,
      backgroundColor: "var(--ss-topbar-surface)",
      borderBottom: "1px solid var(--ss-topbar-border)",
    }}>
      <nav style={{
        height: 80,
        display: "flex",
        alignItems: "center",
        width: "100%",
        maxWidth: "100%",
      }}>
        {/* _8RhTFG_topbarLeft */}
        <div style={{ flex: 1, height: "100%", display: "flex", alignItems: "center", minWidth: 86, flexShrink: 0 }}>
          <div style={{ minWidth: 8, flexShrink: 0 }} />
          <a
            href="/practice"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 80,
              height: 80,
              flexShrink: 0,
              textDecoration: "none",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 52,
                height: 52,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                backgroundColor: "var(--ss-logo-plate)",
                border: "1px solid var(--ss-logo-plate-border)",
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  display: "block",
                  backgroundColor: "var(--ss-logo)",
                  WebkitMaskImage: "url(/images/logo.png)",
                  WebkitMaskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  WebkitMaskSize: "contain",
                  maskImage: "url(/images/logo.png)",
                  maskRepeat: "no-repeat",
                  maskPosition: "center",
                  maskSize: "contain",
                }}
              />
            </span>
          </a>
          <div style={{ flex: 1 }} />
        </div>

        {/* _8RhTFG_topbarCenter */}
        <div style={{
          flex: "0 0 auto",
          width: 350,
          maxWidth: 350,
          height: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}>
          <NavItem label="Search" onClick={onSearchOpen}><SearchIcon /></NavItem>
          <NavItem href="#" label="My tabs"><StarIcon /></NavItem>
          <NavItem href="#" label="New tab"><NewTabIcon /></NavItem>
        </div>

        {/* _8RhTFG_topbarRight */}
        <div style={{ flex: 1, height: "100%", display: "flex", alignItems: "center", minWidth: 0 }}>
          <div style={{ flex: 1 }} />
          <NavItem href="#" label="Help"><HelpIcon /></NavItem>
          <div style={{ flex: 1 }} />
          <NavItem
            label={isDark ? "Light" : "Night"}
            onClick={toggleTheme}
          >
            {isDark ? <LightThemeIcon /> : <DarkThemeIcon />}
          </NavItem>
          <div style={{ position: "relative", display: "flex", flexShrink: 0 }}>
            <NavItem href="#" label="Inbox"><InboxIcon /></NavItem>
            <div style={{
              position: "absolute", top: 12, left: "calc(50% - 2px)",
              minWidth: 19, height: 19,
              backgroundColor: "#238c35",
              color: "white",
              borderRadius: 9.5,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700, lineHeight: "19px",
              padding: "0 3px",
              border: "2px solid var(--ss-topbar-surface)",
              pointerEvents: "none",
            }}>8</div>
          </div>
          <NavItem href="#" label="Abhinav Nigam" wide><ProfileIcon /></NavItem>
          <div style={{ minWidth: 8, flexShrink: 0 }} />
        </div>
      </nav>
    </header>
  );
}
