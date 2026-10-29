import type { Metadata } from "next";
import "./globals.css";
import "./portal.css";

export const metadata: Metadata = {
  title: "DocDesk | Clinic operations",
  description: "A calmer workspace for clinic reception and care teams.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
