import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Guitar Practice Coach",
  description: "Practice tabs with AI note-by-note feedback",
  icons: {
    icon: "/images/songsterr.png",
    apple: "/images/songsterr.png",
  },
};

// Songsterr system font: "songsterr",-apple-system,system-ui,BlinkMacSystemFont,Arial,sans-serif
// "songsterr" is their proprietary face; we fall through to system-ui which is identical on macOS/Windows
const SYSTEM_FONT = "-apple-system,system-ui,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif";

const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('ss-theme');if(t==='light')document.documentElement.classList.remove('dark');else document.documentElement.classList.add('dark');}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistMono.variable} h-full antialiased dark`}
      style={{ fontFamily: SYSTEM_FONT }}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col" style={{ fontFamily: SYSTEM_FONT }}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
