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
        <nav className="bg-zinc-950 sticky top-0 z-50 h-14 flex items-center shadow-[0_1px_0_0_rgba(255,255,255,0.06)]">
          <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 flex items-center gap-6">
            <Link href="/" className="font-mono font-bold text-amber-400 text-base tracking-tight shrink-0">
              AgentOS
            </Link>
            <div className="flex items-center gap-0.5 text-sm">
              <Link href="/" className="px-2.5 py-1.5 text-zinc-500 hover:text-zinc-100 hover:bg-white/5 rounded-md transition-colors">Dashboard</Link>
              <Link href="/runs" className="px-2.5 py-1.5 text-zinc-500 hover:text-zinc-100 hover:bg-white/5 rounded-md transition-colors">Ejecuciones</Link>
              <Link href="/agents" className="px-2.5 py-1.5 text-zinc-500 hover:text-zinc-100 hover:bg-white/5 rounded-md transition-colors">Agentes</Link>
              <Link href="/schedules" className="px-2.5 py-1.5 text-zinc-500 hover:text-zinc-100 hover:bg-white/5 rounded-md transition-colors">Automatizaciones</Link>
            </div>
            <LogoutButton />
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
