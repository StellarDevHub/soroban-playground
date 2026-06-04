"use client";

import React from "react";
import TemplateLibraryGrid from "../../components/TemplateLibraryGrid";

export default function TemplateLibraryPage() {
  return (
    <main className="min-h-screen bg-slate-950 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
            Contract Template Library
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Browse, search, and favorite Soroban smart contract templates to
            quickly bootstrap your next project.
          </p>
        </div>

        <TemplateLibraryGrid />
      </div>
    </main>
  );
}
