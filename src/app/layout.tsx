import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gill Truck Parts — Enterprise Management",
  description:
    "Inventory, counter sales, purchasing and accounting for Gill Truck Parts.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The app is a dense desktop surface; pinch-zoom is how a user reads a
  // grid on a small screen, so it stays enabled.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="h-screen w-screen overflow-hidden">{children}</body>
    </html>
  );
}
