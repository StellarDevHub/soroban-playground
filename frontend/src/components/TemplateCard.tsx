"use client";

import React from "react";
import Link from "next/link";
import { Star } from "lucide-react";

export interface TemplateData {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  path: string;
  code: string;
}

interface TemplateCardProps {
  template: TemplateData;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
}

export default function TemplateCard({
  template,
  isFavorite,
  onToggleFavorite,
}: TemplateCardProps) {
  return (
    <article
      role="article"
      aria-label={`Template: ${template.name}`}
      className="group relative rounded-[20px] border border-slate-800 bg-slate-900/50 p-5 shadow-sm backdrop-blur transition hover:border-slate-700 hover:bg-slate-900/80"
    >
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/playground?template=${template.id}`}
          className="flex-1 min-w-0"
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {template.category}
            </span>
          </div>
          <h3 className="mt-2 text-sm font-semibold text-white truncate">
            {template.name}
          </h3>
          <p className="mt-1 text-xs text-slate-400 line-clamp-2">
            {template.description}
          </p>
        </Link>

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onToggleFavorite(template.id);
          }}
          aria-label={
            isFavorite ? "Remove from favorites" : "Add to favorites"
          }
          className={`shrink-0 p-1.5 rounded-lg transition-colors ${
            isFavorite
              ? "text-amber-400 hover:text-amber-300"
              : "text-slate-600 hover:text-slate-400"
          }`}
        >
          <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 overflow-x-auto">
        <pre className="text-[10px] leading-relaxed text-slate-500 font-mono whitespace-pre">
          {template.code}
        </pre>
      </div>
    </article>
  );
}
