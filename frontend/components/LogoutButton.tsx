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
      className="ml-auto text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
    >
      Salir
    </button>
  );
}
