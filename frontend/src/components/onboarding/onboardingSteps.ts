import type { ComponentType } from "react";
import { CheckCircle2, Code2, Hammer, Play, Rocket, Sparkles } from "lucide-react";

export type TourIcon = ComponentType<{ size?: number; className?: string }>;

export interface OnboardingStep {
  id: string;
  title: string;
  summary: string;
  details: string[];
  target?: string;
  icon: TourIcon;
}

export const ONBOARDING_STORAGE_KEY = "soroban.playground.onboarding.v1";

/**
 * Ordered walkthrough for the hello-world contract journey:
 * write -> compile -> deploy -> invoke.
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to the Soroban Playground",
    summary:
      "A quick four-step tour that walks you through shipping your first hello-world contract on the Stellar network.",
    details: [
      "The tour auto-starts for first-time visitors only.",
      "Press Escape or Skip to dismiss it — you can reopen it any time from the sidebar footer.",
      "Everything runs in your browser against the Soroban testnet toolchain.",
    ],
    target: "[data-tour='sidebar']",
    icon: Sparkles,
  },
  {
    id: "write",
    title: "1. Write the hello-world contract",
    summary:
      "The editor is pre-loaded with a Soroban hello-world contract exposing `hello(name)` and `version()`.",
    details: [
      "Edit `lib.rs` in the Contract Editor pane.",
      "Use Format to run rustfmt, and the docs button for the Soroban quickstart.",
      "Drag the divider between the editor and the output panel to resize your workspace.",
    ],
    target: "[data-tour='main']",
    icon: Code2,
  },
  {
    id: "compile",
    title: "2. Compile against the toolchain",
    summary:
      "Hit Compile to build a WASM artifact with the remote Soroban toolchain and watch live worker metrics.",
    details: [
      "Compile Metrics shows cache hit rate, queue depth and worker usage.",
      "Failed builds surface the exact compiler diagnostics in the console.",
      "Batch Compile lets you build several contract variants at once.",
    ],
    target: "[data-tour='main']",
    icon: Hammer,
  },
  {
    id: "deploy",
    title: "3. Deploy to Stellar Testnet",
    summary:
      "Deploy publishes the compiled artifact to the Stellar testnet and mints you a contract ID.",
    details: [
      "Link a Freighter wallet from the header if the deployment requires signing.",
      "The Pipeline Tracker streams each deployment step as it completes.",
      "Your contract ID is reused automatically by the invoke panel.",
    ],
    target: "[data-tour='wallet']",
    icon: Rocket,
  },
  {
    id: "invoke",
    title: "4. Invoke `hello` and inspect the result",
    summary:
      "Call any exported function from the Call Panel, then inspect storage, events and the transaction call graph.",
    details: [
      "Arguments are typed from the parsed contract ABI.",
      "Results, logs and events stream into the console in real time.",
      "Open the WASM Inspector from the sidebar to decompile the artifact you just built.",
    ],
    target: "[data-tour='main']",
    icon: Play,
  },
  {
    id: "finish",
    title: "You're ready to build",
    summary:
      "That's the full loop: write, compile, deploy, invoke. Repeat it for any contract in the template library.",
    details: [
      "Bookmark the playground or add it to your home screen for quick access.",
      "Reopen this walkthrough whenever you want a refresher.",
      "Zero regressions, zero lock-in — everything stays in your browser.",
    ],
    icon: CheckCircle2,
  },
];
