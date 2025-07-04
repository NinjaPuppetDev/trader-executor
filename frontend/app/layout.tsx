// app/layout.tsx
import "./globals.css";
import { ReactNode } from "react";
import ClientRoot from "../app/components/ClientRoot";


export const metadata = {
  title: "AI Prompt Oracle",
  description: "Chainlink + AI prompt dApp",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900">
        <ClientRoot>
          <main className="min-h-screen py-10 px-4">
            {children}
          </main>
        </ClientRoot>
      </body>
    </html>
  );
}