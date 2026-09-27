"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import { ONBOARDING_STEPS, ONBOARDING_STORAGE_KEY, type OnboardingStep } from "./onboardingSteps";

interface TourProgress {
  completed: boolean;
  dismissed: boolean;
  step: number;
}

const DEFAULT_PROGRESS: TourProgress = { completed: false, dismissed: false, step: 0 };
const HIGHLIGHT_PADDING = 8;
const CARD_WIDTH = 360;

function readProgress(): TourProgress {
  if (typeof window === "undefined") return DEFAULT_PROGRESS;
  try {
    const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    const parsed = JSON.parse(raw) as Partial<TourProgress>;
    return {
      completed: Boolean(parsed.completed),
      dismissed: Boolean(parsed.dismissed),
      step: Number.isFinite(parsed.step) ? Math.max(0, Number(parsed.step)) : 0,
    };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

function writeProgress(progress: TourProgress) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Ignore storage failures (private mode, blocked cookies, ...).
  }
}

function measureTarget(selector?: string): DOMRect | null {
  if (!selector || typeof document === "undefined") return null;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
}

function positionCard(rect: DOMRect | null): React.CSSProperties {
  if (!rect) {
    return {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: `min(${CARD_WIDTH}px, calc(100vw - 2rem))`,
    };
  }

  const margin = HIGHLIGHT_PADDING + 16;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const spaceRight = viewportWidth - rect.right;
  const spaceBelow = viewportHeight - rect.bottom;

  let left: number;
  let top: number;

  if (spaceRight >= CARD_WIDTH + margin) {
    left = rect.right + margin;
    top = Math.min(Math.max(rect.top, margin), viewportHeight - 260);
  } else if (spaceBelow >= 220) {
    left = Math.min(
      Math.max(rect.left, margin),
      Math.max(margin, viewportWidth - CARD_WIDTH - margin),
    );
    top = rect.bottom + margin;
  } else {
    left = Math.min(
      Math.max(rect.left, margin),
      Math.max(margin, viewportWidth - CARD_WIDTH - margin),
    );
    top = Math.max(margin, rect.top - 240);
  }

  return {
    top: Math.max(margin, top),
    left: Math.max(margin, Math.min(left, viewportWidth - CARD_WIDTH - margin)),
    width: `min(${CARD_WIDTH}px, calc(100vw - 2rem))`,
  };
}

export default function OnboardingTour() {
  const [isOpen, setIsOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const step: OnboardingStep = ONBOARDING_STEPS[stepIndex] ?? ONBOARDING_STEPS[0];
  const isLast = stepIndex >= ONBOARDING_STEPS.length - 1;

  const persist = useCallback((next: TourProgress) => writeProgress(next), []);

  const finish = useCallback(
    (completed: boolean) => {
      setIsOpen(false);
      setRect(null);
      setHydrated(true);
      persist({ completed, dismissed: !completed, step: stepIndex });
    },
    [persist, stepIndex],
  );

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), ONBOARDING_STEPS.length - 1);
      setStepIndex(clamped);
      persist({ completed: false, dismissed: false, step: clamped });
    },
    [persist],
  );

  // First-visit auto start.
  useEffect(() => {
    const progress = readProgress();
    setStepIndex(progress.step);
    if (progress.completed || progress.dismissed) {
      setHydrated(true);
      return;
    }

    const timer = window.setTimeout(() => setIsOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, []);

  // Keep the spotlight aligned while the user scrolls, resizes or the DOM changes.
  useEffect(() => {
    if (!isOpen) return;

    const refresh = () => setRect(measureTarget(step.target));
    refresh();
    const interval = window.setInterval(refresh, 400);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [isOpen, step.target]);

  // Focus the card whenever the active step changes.
  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => cardRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, stepIndex]);

  // Keyboard navigation.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
        return;
      }
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        if (isLast) finish(true);
        else goTo(stepIndex + 1);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(stepIndex - 1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, isLast, stepIndex, finish, goTo]);

  const StepIcon = step.icon;

  if (!isOpen) {
    if (!hydrated) return null;
    return (
      <button
        type="button"
        onClick={() => {
          setStepIndex(0);
          setRect(null);
          setIsOpen(true);
        }}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border border-teal-500/30 bg-slate-950/90 px-4 py-2.5 text-xs font-semibold text-teal-300 shadow-lg backdrop-blur transition hover:border-teal-400/60 hover:text-teal-200"
        aria-label="Restart the playground tour"
      >
        <RotateCcw size={14} />
        Replay tour
      </button>
    );
  }

  const highlightStyle: React.CSSProperties | undefined = rect
    ? {
        top: rect.top - HIGHLIGHT_PADDING,
        left: rect.left - HIGHLIGHT_PADDING,
        width: rect.width + HIGHLIGHT_PADDING * 2,
        height: rect.height + HIGHLIGHT_PADDING * 2,
      }
    : undefined;

  return (
    <div className="fixed inset-0 z-[95]" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      {/* Dimmed backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-[2px]"
        onClick={() => finish(false)}
        aria-hidden="true"
      />

      {/* Spotlight hole punched through the backdrop */}
      {highlightStyle && (
        <div
          className="pointer-events-none absolute rounded-xl border-2 border-teal-400/70 shadow-[0_0_0_9999px_rgba(2,6,23,0.75),0_0_30px_rgba(45,212,191,0.35)]"
          style={highlightStyle}
          aria-hidden="true"
        />
      )}

      {/* Step card */}
      <div
        ref={cardRef}
        tabIndex={-1}
        style={positionCard(rect)}
        className="absolute z-10 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-700/70 bg-slate-900/95 p-5 shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400/20 to-orange-400/20 text-teal-300">
              <StepIcon size={18} />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Step {stepIndex + 1} of {ONBOARDING_STEPS.length}
              </p>
              <h2
                id="onboarding-title"
                className="text-sm font-semibold leading-5 text-white sm:text-base"
              >
                {step.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => finish(false)}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
            aria-label="Close the tour"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-sm leading-6 text-slate-300">{step.summary}</p>

        <ul className="mt-3 space-y-2">
          {step.details.map((detail) => (
            <li key={detail} className="flex gap-2 text-xs leading-5 text-slate-400">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal-400" aria-hidden="true" />
              {detail}
            </li>
          ))}
        </ul>

        {/* Progress bar */}
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-400 to-cyan-400 transition-all duration-300"
            style={{ width: `${((stepIndex + 1) / ONBOARDING_STEPS.length) * 100}%` }}
            role="progressbar"
            aria-valuenow={stepIndex + 1}
            aria-valuemin={1}
            aria-valuemax={ONBOARDING_STEPS.length}
            aria-label="Tour progress"
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => finish(false)}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-200"
          >
            Skip tour
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goTo(stepIndex - 1)}
              disabled={stepIndex === 0}
              className="flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft size={14} />
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (isLast) finish(true);
                else goTo(stepIndex + 1);
              }}
              className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-teal-400 to-teal-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:from-teal-300 hover:to-teal-400"
            >
              {isLast ? "Get started" : "Next"}
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Step dots */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {ONBOARDING_STEPS.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => goTo(index)}
              aria-label={`Go to step ${index + 1}: ${item.title}`}
              aria-current={index === stepIndex ? "step" : undefined}
              className={`h-1.5 rounded-full transition-all ${
                index === stepIndex ? "w-6 bg-teal-400" : "w-1.5 bg-slate-600 hover:bg-slate-500"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
