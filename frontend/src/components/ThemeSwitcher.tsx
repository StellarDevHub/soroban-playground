"use client";

import React from "react";
import { Contrast, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/providers/ThemeProvider";
import type { ThemePreference } from "@/lib/theme/types";

interface ThemeOption {
  value: ThemePreference;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

const OPTIONS: ThemeOption[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "high-contrast", label: "High Contrast", Icon: Contrast },
  { value: "system", label: "System", Icon: Monitor },
];

/**
 * Segmented light / dark / system theme control.
 *
 * The active option is only highlighted after mount so the server-rendered
 * markup (always the default theme) matches the first client render and React
 * does not report a hydration mismatch — the real theme is already on screen
 * thanks to the pre-paint bootstrap script.
 */
export default function ThemeSwitcher({ className = "" }: { className?: string }) {
  const { state, setPreference } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const active: ThemePreference | null = mounted ? state.preference : null;

  return (
    <div
      role="group"
      aria-label="Colour theme"
      data-testid="theme-switcher"
      data-active-theme={active ?? undefined}
      className={`flex items-center gap-0.5 rounded-lg border border-slate-800/60 bg-slate-900/60 p-0.5 ${className}`}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const isActive = active === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setPreference(value)}
            aria-pressed={isActive}
            aria-label={`Use ${label.toLowerCase()} theme`}
            title={`${label} theme`}
            className={`flex items-center justify-center rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              isActive
                ? "bg-teal-500/20 text-teal-300 border border-teal-500/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent"
            }`}
          >
            <Icon size={13} aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
