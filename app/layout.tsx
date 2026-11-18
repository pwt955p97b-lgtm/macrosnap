import type { Metadata, Viewport } from "next";
import "./globals.css";

const captureInvitationScript = `
  (() => {
    const fragment = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    const token = new URLSearchParams(fragment).get("invite");
    if (!token) return;
    Object.defineProperty(window, "__macroSnapInvitationToken", { value: token, configurable: true });
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  })();
`;

export const metadata: Metadata = {
  title: "MacroSnap — Food tracking made simple",
  description: "Snap a meal and keep your daily nutrition goals in view.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8faf6",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head><script dangerouslySetInnerHTML={{ __html: captureInvitationScript }} /></head>
      <body>
        {children}
      </body>
    </html>
  );
}
