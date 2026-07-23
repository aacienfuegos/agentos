"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function KnowledgeAgentDetailRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => { router.replace(`/knowledge-bases/${id}`); }, [id, router]);
  return null;
}
