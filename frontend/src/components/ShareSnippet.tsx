"use client";

// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React, { useState } from "react";
import { Link2, Check, Loader2 } from "lucide-react";

interface ShareSnippetProps {
  code: string;
  apiBaseUrl: string;
}

/**
 * Saves the current editor code as a shareable snippet via the backend API
 * and copies the resulting share URL to the clipboard.
 */
export default function ShareSnippet({ code, apiBaseUrl }: ShareSnippetProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "copied" | "error">("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const handleShare = async () => {
    if (!code.trim()) return;
    setStatus("loading");

    try {
      const res = await fetch(`${apiBaseUrl}/api/snippets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language: "rust", title: "Soroban Snippet" }),
      });

      if (!res.ok) throw new Error("Failed to save snippet");

      const { snippet } = await res.json() as { snippet: { shareUrl: string } };
      setShareUrl(snippet.shareUrl);

      await navigator.clipboard.writeText(snippet.shareUrl);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2500);
    }
  };

  const label =
    status === "loading" ? "Sharing…"
    : status === "copied"  ? "Link copied!"
    : status === "error"   ? "Error – retry"
    : "Share";

  return (
    <button
      onClick={handleShare}
      disabled={status === "loading" || !code.trim()}
      aria-label="Share snippet as URL"
      title={shareUrl ?? "Share current code as a link"}
      className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-400/20 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {status === "loading" ? (
        <Loader2 size={14} className="animate-spin" />
      ) : status === "copied" ? (
        <Check size={14} />
      ) : (
        <Link2 size={14} />
      )}
      {label}
    </button>
  );
}
