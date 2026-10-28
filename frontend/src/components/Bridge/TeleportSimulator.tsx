"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Copy,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { bridgeReducer, INITIAL_BRIDGE_STATE } from "./bridgeMachine";
import { calculateBridgeFees, formatFixed } from "./fees";
import { generateMerkleProof, verifyMerkleProof } from "./merkle";
import type {
  BridgeDirection,
  BridgeMachineState,
  BridgePhase,
  BridgeStep,
  FailureScenario,
} from "./types";

const DIRECTIONS: { value: BridgeDirection; label: string }[] = [
  { value: "stellar-to-evm", label: "Stellar Soroban to EVM" },
  { value: "stellar-to-cosmos", label: "Stellar Soroban to Cosmos" },
  { value: "evm-to-stellar", label: "EVM to Stellar Soroban" },
  { value: "cosmos-to-stellar", label: "Cosmos to Stellar Soroban" },
];

const SCENARIOS: { value: FailureScenario | "none"; label: string }[] = [
  { value: "none", label: "No injected failure" },
  { value: "signature-expired", label: "Signature expiration" },
  { value: "replay-attack", label: "Replay attack (same nonce)" },
  { value: "relayer-timeout", label: "Relayer timeout" },
];

const FAILURE_COPY: Partial<Record<BridgePhase, string>> = {
  failed_signature_expired:
    "The relayer signature TTL elapsed before the destination chain accepted the submission.",
  failed_replay_detected:
    "The destination rejected this nonce because it was already consumed by an earlier transfer.",
  failed_relayer_timeout:
    "The relayer did not return a proof before the timeout window closed. Retry to request a fresh proof.",
};

const STEP_LABELS = ["Source Lock", "Relayer Proof", "Destination Mint / Unlock", "Complete"];
const INPUT_CLASS =
  "w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400";
const BUTTON_CLASS =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-slate-400 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:opacity-50";

function phaseIndex(phase: BridgePhase): number {
  if (phase === "idle" || phase === "source_locked") return 0;
  if (phase === "relayer_proof_pending" || phase === "proof_generated") return 1;
  if (phase === "failed_relayer_timeout") return 1;
  if (phase === "failed_signature_expired" || phase === "failed_replay_detected") return 2;
  if (phase === "completed") return 3;
  if (phase === "destination_minted" || phase === "unlocked") return 2;
  return 3;
}

function elapsedForTimelineStep(
  state: BridgeMachineState,
  startedAt: BridgeStep,
  endedAt: BridgeStep,
): number | null {
  const start = state.transaction?.timestamps[startedAt];
  if (start === undefined) return null;
  const end = state.transaction?.timestamps[endedAt] ?? state.clockMs;
  return Math.max(0, end - start);
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function chainNames(direction: BridgeDirection): [string, string] {
  const [from, to] = direction.split("-to-");
  const pretty = (chain: string) =>
    chain === "stellar"
      ? "Stellar Soroban"
      : chain === "evm"
        ? "EVM"
        : "Cosmos";
  return [pretty(from), pretty(to)];
}

export default function TeleportSimulator() {
  const [machine, setMachine] = useState<BridgeMachineState>(INITIAL_BRIDGE_STATE);
  const [direction, setDirection] = useState<BridgeDirection>("stellar-to-evm");
  const [mode, setMode] = useState<"lock-and-mint" | "burn-and-unlock">("lock-and-mint");
  const [amount, setAmount] = useState("250.00");
  const [asset, setAsset] = useState("USDC");
  const [slippage, setSlippage] = useState("0.50");
  const [formError, setFormError] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [tamperedLeaf, setTamperedLeaf] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const [sourceChain, destinationChain] = chainNames(direction);
  const feeQuote = useMemo(() => {
    try {
      return { quote: calculateBridgeFees(amount, direction, slippage), error: null };
    } catch (error) {
      return {
        quote: null,
        error: error instanceof Error ? error.message : "Unable to calculate fees.",
      };
    }
  }, [amount, direction, slippage]);

  const transaction = machine.transaction;
  const proof = useMemo(() => {
    if (!transaction || transaction.timestamps.proof_generated === undefined) return null;
    return generateMerkleProof(
      [
        `${transaction.id}:${transaction.nonce}:${transaction.amount}:${transaction.asset}`,
        `${transaction.sourceChain}:${transaction.destinationChain}:${transaction.mode}`,
      ],
      0,
    );
  }, [transaction]);
  const proofValid = proof
    ? verifyMerkleProof(
        tamperedLeaf || proof.leaf,
        proof.root,
        proof.siblings,
        proof.index,
      )
    : false;

  useEffect(() => {
    const transactionId = machine.transaction?.id;
    if (
      machine.paused ||
      !transactionId ||
      machine.phase === "completed" ||
      machine.phase.startsWith("failed_")
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      setMachine((current) => bridgeReducer(current, { type: "tick", elapsedMs: 250 }).state);
    }, 250);
    return () => window.clearInterval(timer);
  }, [machine.paused, machine.phase, machine.transaction?.id]);

  function dispatch(type: Parameters<typeof bridgeReducer>[1]) {
    const result = bridgeReducer(machine, type);
    setMachine(result.state);
    setTransitionError(result.error);
    return result;
  }

  function startTransfer(nonce = `${Math.floor(Date.now() / 1000)}`) {
    if (!feeQuote.quote) {
      setFormError(feeQuote.error);
      return;
    }
    setFormError(null);
    setTamperedLeaf("");
    dispatch({
      type: "start",
      transaction: {
        id: `BR-${nonce}-${Math.floor(Date.now() % 10_000)}`,
        nonce,
        amount,
        asset,
        direction,
        mode,
      },
    });
  }

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1_500);
    } catch {
      setTransitionError("Clipboard access is unavailable in this browser context.");
    }
  }

  const steps = [
    { phase: "source_locked", startedAt: "source_locked", endedAt: "relayer_proof_pending", title: STEP_LABELS[0] },
    { phase: "proof_generated", startedAt: "relayer_proof_pending", endedAt: "proof_generated", title: STEP_LABELS[1] },
    { phase: mode === "lock-and-mint" ? "destination_minted" : "unlocked", startedAt: "proof_generated", endedAt: mode === "lock-and-mint" ? "destination_minted" : "unlocked", title: STEP_LABELS[2] },
    { phase: "completed", startedAt: mode === "lock-and-mint" ? "destination_minted" : "unlocked", endedAt: "completed", title: STEP_LABELS[3] },
  ] as const;
  const activeStep = phaseIndex(machine.phase);
  const failed = machine.phase.startsWith("failed_");
  const isRunning = Boolean(transaction) && machine.phase !== "completed" && !failed;
  const packetPosition = Math.min(92, Math.max(8, activeStep * 27 + (isRunning ? 7 : 0)));

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 border-b border-slate-800 pb-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">
                <Activity size={14} aria-hidden="true" /> Bridge lab / FE-24
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Cross-chain teleport simulator
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Model lock, relay, proof verification, and destination settlement across Soroban, EVM, and Cosmos.
              </p>
            </div>
            <div className="flex items-center gap-2 border-l-2 border-cyan-400 pl-3 text-xs text-slate-300">
              <ShieldCheck size={17} className="text-emerald-300" aria-hidden="true" />
              Nonce-protected demo
            </div>
          </div>
        </header>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,0.65fr)]">
          <div className="space-y-6">
            <section className="border border-slate-800 bg-slate-900/70 p-4 sm:p-6" aria-labelledby="route-heading">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 id="route-heading" className="text-sm font-semibold uppercase tracking-wider text-slate-200">Transfer route</h2>
                <span className="font-mono text-xs text-slate-500">{transaction?.id ?? "NO ACTIVE TX"}</span>
              </div>
              <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-5">
                <div className="min-w-0">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Source chain</p>
                  <div className="border border-cyan-900/70 bg-slate-950 px-3 py-3">
                    <p className="truncate text-sm font-semibold text-cyan-100">{sourceChain}</p>
                    <p className="mt-1 text-xs text-slate-500">{mode === "lock-and-mint" ? "Vault lock" : "Wrapped burn"}</p>
                  </div>
                </div>
                <div className="relative h-px w-20 bg-slate-700 sm:w-36" aria-hidden="true">
                  <span
                    className="absolute -top-3 grid h-6 w-6 place-items-center rounded-full border border-cyan-300 bg-slate-950 text-cyan-200 shadow-[0_0_16px_rgba(34,211,238,0.3)] transition-[left] duration-700 motion-reduce:transition-none"
                    style={{ left: `calc(${packetPosition}% - 12px)` }}
                  >
                    <ArrowDownUp size={13} />
                  </span>
                </div>
                <div className="min-w-0 text-right">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Destination chain</p>
                  <div className="border border-emerald-900/70 bg-slate-950 px-3 py-3">
                    <p className="truncate text-sm font-semibold text-emerald-100">{destinationChain}</p>
                    <p className="mt-1 text-xs text-slate-500">{mode === "lock-and-mint" ? "Wrapped mint" : "Native unlock"}</p>
                  </div>
                </div>
              </div>

              <ol className="grid gap-2 sm:grid-cols-4" aria-label="Bridge transaction progress">
                {steps.map((step, index) => {
                  const stepDone = activeStep > index || machine.phase === "completed";
                  const stepCurrent = activeStep === index && !failed && machine.phase !== "completed";
                  const stepFailed = failed && activeStep === index;
                  const stepElapsed = elapsedForTimelineStep(machine, step.startedAt, step.endedAt);
                  return (
                    <li key={step.phase} className={`min-h-[82px] border p-3 ${stepFailed ? "border-rose-700 bg-rose-950/30" : stepDone ? "border-emerald-800 bg-emerald-950/20" : stepCurrent ? "border-cyan-700 bg-cyan-950/20" : "border-slate-800 bg-slate-950/60"}`}>
                      <div className="flex items-center gap-2">
                        {stepFailed ? <XCircle size={15} className="text-rose-300" aria-hidden="true" /> : stepDone ? <CheckCircle2 size={15} className="text-emerald-300" aria-hidden="true" /> : stepCurrent ? <Clock3 size={15} className="text-cyan-300" aria-hidden="true" /> : <Circle size={15} className="text-slate-600" aria-hidden="true" />}
                        <span className="text-xs font-medium text-slate-200">{step.title}</span>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        {stepElapsed === null
                          ? "Waiting"
                          : `${formatDuration(stepElapsed)} · ${stepDone ? index === 0 ? "3/3" : index === 1 ? "2/2" : "1/1" : index === 0 ? "1/3" : "0/2"} confirmations`}
                      </p>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
                <button type="button" className={BUTTON_CLASS} onClick={() => dispatch({ type: "pause", paused: !machine.paused })} disabled={!isRunning} aria-label={machine.paused ? "Resume simulation" : "Pause simulation"}>
                  {machine.paused ? <Play size={15} /> : <Pause size={15} />}{machine.paused ? "Resume" : "Pause"}
                </button>
                <div className="flex items-center gap-1" role="group" aria-label="Simulation speed">
                  {[1, 2, 5].map((speed) => (
                    <button key={speed} type="button" onClick={() => dispatch({ type: "set-speed", speed: speed as 1 | 2 | 5 })} aria-pressed={machine.speed === speed} className={`min-h-10 rounded border px-3 text-sm ${machine.speed === speed ? "border-cyan-500 bg-cyan-950 text-cyan-100" : "border-slate-700 bg-slate-900 text-slate-400 hover:text-white"}`}>{speed}x</button>
                  ))}
                </div>
                <button type="button" className={BUTTON_CLASS} onClick={() => { dispatch({ type: "reset" }); setFormError(null); setTamperedLeaf(""); }}>
                  <RotateCcw size={15} /> Reset
                </button>
                <span className="ml-auto font-mono text-xs text-slate-500" aria-live="polite">Sim clock {formatDuration(machine.clockMs)}</span>
              </div>
            </section>

            <section className="border border-slate-800 bg-slate-900/70 p-4 sm:p-6" aria-labelledby="configuration-heading">
              <div className="mb-5 flex items-center justify-between gap-3">
                <h2 id="configuration-heading" className="text-sm font-semibold uppercase tracking-wider text-slate-200">Transfer configuration</h2>
                <span className="text-xs text-slate-500">Mock network rates</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-300" htmlFor="bridge-direction">Direction
                  <select id="bridge-direction" value={direction} onChange={(event) => setDirection(event.target.value as BridgeDirection)} className={`${INPUT_CLASS} mt-1.5`}>
                    {DIRECTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-300" htmlFor="bridge-mode">Bridge mode
                  <select id="bridge-mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} className={`${INPUT_CLASS} mt-1.5`}>
                    <option value="lock-and-mint">Lock and mint wrapped asset</option>
                    <option value="burn-and-unlock">Burn and unlock native asset</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-300" htmlFor="bridge-asset">Asset
                  <select id="bridge-asset" value={asset} onChange={(event) => setAsset(event.target.value)} className={`${INPUT_CLASS} mt-1.5`}>
                    <option>USDC</option><option>XLM</option><option>EURC</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-300" htmlFor="bridge-amount">Amount
                  <input id="bridge-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={`${INPUT_CLASS} mt-1.5`} aria-describedby="amount-fee-error" />
                </label>
                <label className="block text-xs font-medium text-slate-300" htmlFor="bridge-slippage">Slippage tolerance (%)
                  <input id="bridge-slippage" inputMode="decimal" value={slippage} onChange={(event) => setSlippage(event.target.value)} className={`${INPUT_CLASS} mt-1.5`} aria-describedby="slippage-hint" />
                  <span id="slippage-hint" className="mt-1 block text-[11px] font-normal text-slate-500">Range: 0 to 50%. More than two decimals is not accepted.</span>
                </label>
                <label className="block text-xs font-medium text-slate-300" htmlFor="failure-scenario">Failure scenario
                  <select id="failure-scenario" value={machine.failureScenario ?? "none"} onChange={(event) => dispatch({ type: "set-scenario", scenario: event.target.value === "none" ? null : event.target.value as FailureScenario })} className={`${INPUT_CLASS} mt-1.5`}>
                    {SCENARIOS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
              </div>
              {feeQuote.error && <p id="amount-fee-error" className="mt-3 text-xs text-amber-300" role="status">{feeQuote.error}</p>}
              {formError && <p className="mt-3 text-xs text-rose-300" role="alert">{formError}</p>}
              <button type="button" className={`${BUTTON_CLASS} mt-4 border-cyan-700 bg-cyan-950/60 text-cyan-100 hover:bg-cyan-900/70`} onClick={() => startTransfer()} disabled={isRunning}>
                <Play size={15} /> Start transfer
              </button>
              {transaction && machine.phase === "completed" && <button type="button" className={`${BUTTON_CLASS} ml-2 mt-4`} onClick={() => startTransfer(transaction.nonce)}>Run again with same nonce</button>}
              {machine.phase === "failed_relayer_timeout" && <button type="button" className={`${BUTTON_CLASS} ml-2 mt-4 border-amber-700 text-amber-200`} onClick={() => dispatch({ type: "retry" })}><RotateCcw size={15} /> Retry relayer</button>}
            </section>

            <section className="border border-slate-800 bg-slate-900/70 p-4 sm:p-6" aria-labelledby="fees-heading">
              <div className="mb-4 flex items-center justify-between">
                <h2 id="fees-heading" className="text-sm font-semibold uppercase tracking-wider text-slate-200">Fee estimate</h2>
                <span className="text-xs text-slate-500">Illustrative rates, not a quote</span>
              </div>
              {feeQuote.quote ? (
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  <FeeItem label="Relayer fee" value={`${formatFixed(feeQuote.quote.relayerFeeMicros)} ${asset}`} />
                  <FeeItem label="Source network fee" value={`${formatFixed(feeQuote.quote.sourceFeeXlmMicros)} XLM`} />
                  <FeeItem label="Destination gas" value={`${formatFixed(feeQuote.quote.destinationGasMicros)} ${feeQuote.quote.destinationGasCurrency}`} />
                  <FeeItem label="Gas equivalent" value={`${formatFixed(feeQuote.quote.destinationGasXlmMicros)} XLM`} />
                  <FeeItem label="Minimum received" value={`${formatFixed(feeQuote.quote.minReceivedMicros)} ${asset}`} />
                  <FeeItem label="Estimated transit" value={`~${feeQuote.quote.estimatedTransitSeconds}s`} />
                </dl>
              ) : <p className="text-sm text-slate-500">Enter valid transfer inputs to calculate fees.</p>}
            </section>
          </div>

          <aside className="space-y-6">
            <section className="border border-slate-800 bg-slate-900/70 p-4 sm:p-5" aria-labelledby="status-heading">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 id="status-heading" className="text-sm font-semibold uppercase tracking-wider text-slate-200">Transaction status</h2>
                <span className={`border px-2 py-1 font-mono text-[10px] uppercase ${failed ? "border-rose-800 text-rose-300" : machine.phase === "completed" ? "border-emerald-800 text-emerald-300" : "border-cyan-900 text-cyan-200"}`}>{machine.phase.replaceAll("_", " ")}</span>
              </div>
              <p className="min-h-12 text-sm leading-6 text-slate-400" role="status" aria-live="polite">
                {failed ? FAILURE_COPY[machine.phase] : transaction?.history.at(-1)?.message ?? "Configure a transfer and start the simulator."}
              </p>
              {transitionError && <p className="mt-3 text-xs text-amber-300" role="alert">{transitionError}</p>}
              {failed && machine.phase === "failed_relayer_timeout" && <p className="mt-2 flex items-center gap-2 text-xs text-amber-200"><AlertTriangle size={14} /> Source funds remain locked until the relayer retry completes.</p>}
              <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
                {transaction?.history.map((entry, index) => (
                  <div key={`${entry.phase}-${index}`} className="flex gap-3 text-xs">
                    <span className="mt-0.5 text-cyan-300"><Check size={13} aria-hidden="true" /></span>
                    <div className="min-w-0 flex-1"><p className="text-slate-200">{entry.message}</p><p className="mt-1 font-mono text-[10px] text-slate-500">+{formatDuration(entry.timestamp)} · {entry.phase.replaceAll("_", " ")}</p></div>
                  </div>
                ))}
                {transaction && <p className="border-t border-slate-800 pt-3 font-mono text-[11px] text-slate-500">Nonce {transaction.nonce} · {transaction.amount} {transaction.asset}</p>}
              </div>
            </section>

            <section className="border border-slate-800 bg-slate-900/70 p-4 sm:p-5" aria-labelledby="proof-heading">
              <details>
                <summary id="proof-heading" className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold uppercase tracking-wider text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
                  <span className="flex items-center gap-2"><ChevronDown size={15} aria-hidden="true" /> Mock Merkle proof</span>
                  {proof && <span className={`text-[10px] uppercase ${proofValid ? "text-emerald-300" : "text-rose-300"}`}>{proofValid ? "Proof verified" : "Proof invalid"}</span>}
                </summary>
                {!proof ? <p className="mt-4 text-sm text-slate-500">Proof appears after the relayer collects source confirmations.</p> : (
                  <div className="mt-4 space-y-4 text-xs">
                    <label className="block text-slate-400" htmlFor="proof-leaf">Leaf hash
                      <div className="mt-1 flex gap-2"><input id="proof-leaf" value={tamperedLeaf || proof.leaf} onChange={(event) => setTamperedLeaf(event.target.value)} className={`${INPUT_CLASS} min-w-0 font-mono text-[11px]`} /><button type="button" className={BUTTON_CLASS} onClick={() => copyValue("leaf", tamperedLeaf || proof.leaf)} aria-label="Copy Merkle leaf">{copied === "leaf" ? <Check size={14} /> : <Copy size={14} />}</button></div>
                    </label>
                    <div><p className="mb-1 text-slate-400">Merkle root</p><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all border border-slate-800 bg-slate-950 p-2 text-[11px] text-cyan-200">{proof.root}</code><button type="button" className={BUTTON_CLASS} onClick={() => copyValue("root", proof.root)} aria-label="Copy Merkle root">{copied === "root" ? <Check size={14} /> : <Copy size={14} />}</button></div></div>
                    <div><p className="mb-1 text-slate-400">Sibling path · leaf index {proof.index}</p><ol className="space-y-1">{proof.siblings.map((sibling, index) => <li key={`${sibling.hash}-${index}`} className="flex justify-between gap-3 border border-slate-800 bg-slate-950 p-2"><span className="text-slate-500">{sibling.position}</span><code className="break-all text-slate-300">{sibling.hash}</code></li>)}</ol></div>
                    <button type="button" className="text-xs font-medium text-cyan-300 underline decoration-cyan-800 underline-offset-4 hover:text-cyan-100" onClick={() => setTamperedLeaf(tamperedLeaf ? "" : `${proof.leaf.slice(0, -1)}${proof.leaf.endsWith("0") ? "1" : "0"}`)}>{tamperedLeaf ? "Restore valid leaf" : "Tamper with leaf"}</button>
                  </div>
                )}
              </details>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function FeeItem({ label, value }: { label: string; value: string }) {
  return <div className="border-l-2 border-slate-700 pl-3"><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt><dd className="mt-1 font-mono text-sm text-slate-200">{value}</dd></div>;
}