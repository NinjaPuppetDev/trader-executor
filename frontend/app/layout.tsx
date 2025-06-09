import "./globals.css";
import { ReactNode } from "react";
import AIOracleInterface from "./AiOracleFrontend"; // adjust path if needed

export const metadata = {
  title: "AI Prompt Oracle",
  description: "Chainlink + AI prompt dApp",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900">
        <main className="min-h-screen py-10 px-4">
          {/* Render your component here */}

          {children}
        </main>
      </body>
    </html>
  );
}
