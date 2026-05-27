"use client";

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export default function LogoutButton() {
  const handleLogout = async () => {
    try {
      await fetch(`${BASE_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      window.location.href = "/login";
    }
  };

  return (
    <button
      onClick={handleLogout}
      className="ml-auto text-xs text-zinc-500 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 px-3 py-1 rounded transition-colors"
    >
      Salir
    </button>
  );
}
