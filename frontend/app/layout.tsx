import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AgentOS",
  description: "Plataforma personal de orquestación de agentes de IA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} dark`}>
      <body className="antialiased bg-zinc-950 text-zinc-100 min-h-screen">
        <nav className="bg-zinc-900/80 backdrop-blur sticky top-0 z-50 h-14 flex items-center">
          <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 flex items-center gap-6">
            <Link href="/" className="font-mono font-bold text-violet-400 text-lg tracking-tight">
              AgentOS
            </Link>
            <div className="flex gap-4 text-sm">
              <Link href="/" className="text-zinc-400 hover:text-zinc-100 transition-colors">Dashboard</Link>
              <Link href="/runs" className="text-zinc-400 hover:text-zinc-100 transition-colors">Ejecuciones</Link>
              <Link href="/agents" className="text-zinc-400 hover:text-zinc-100 transition-colors">Agentes</Link>
              <Link href="/schedules" className="text-zinc-400 hover:text-zinc-100 transition-colors">Automatizaciones</Link>
            </div>
            <LogoutButton />
          </div>
        </nav>
        <main className="border-t border-zinc-800 max-w-7xl mx-auto px-4 sm:px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
