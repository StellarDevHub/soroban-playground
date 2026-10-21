"use client";

import React, { useMemo, useState } from "react";
import { Download, ExternalLink, RefreshCw, Route, Zap } from "lucide-react";
import { buildDefaultInputValue, type ContractAbiFunction } from "@/utils/contractAbi";
import { extractStateMachine, toPlantUml, toXStateMachine, type StateMachineTransition } from "@/utils/stateMachine";

interface StateMachineModelerProps {
  sourceCode: string;
  abi?: ContractAbiFunction[];
  contractId?: string;
  currentState?: string | null;
  /** Reads the lifecycle value from contract storage. The component refreshes it on mount and on demand. */
  fetchCurrentState?: (contractId: string) => Promise<string | null>;
  onInvoke?: (functionName: string, args: Record<string, unknown>) => void;
  onTransitionSelected?: (transition: StateMachineTransition, args: Record<string, unknown>) => void;
}

function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function transitionDefaults(transition: StateMachineTransition): Record<string, unknown> {
  return (transition.inputs ?? []).reduce<Record<string, unknown>>((values, input) => {
    values[input.name] = buildDefaultInputValue(input.type);
    return values;
  }, {});
}

export default function StateMachineModeler({
  sourceCode,
  abi = [],
  contractId,
  currentState: suppliedState,
  fetchCurrentState,
  onInvoke,
  onTransitionSelected,
}: StateMachineModelerProps) {
  const model = useMemo(() => extractStateMachine(sourceCode, abi), [sourceCode, abi]);
  const [fetchedState, setFetchedState] = useState<string | null | undefined>(undefined);
  const liveState = fetchedState === undefined ? suppliedState ?? null : fetchedState;
  const [selected, setSelected] = useState<StateMachineTransition | null>(null);
  const [selectedArgs, setSelectedArgs] = useState<Record<string, unknown>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refreshState = async () => {
    if (!contractId || !fetchCurrentState) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      setFetchedState(await fetchCurrentState(contractId));
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Unable to read contract state.");
    } finally {
      setRefreshing(false);
    }
  };

  const selectTransition = (transition: StateMachineTransition) => {
    const args = transitionDefaults(transition);
    setSelected(transition);
    setSelectedArgs(args);
    onTransitionSelected?.(transition, args);
  };

  if (model.states.length === 0) {
    return (
      <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-5" aria-label="State machine modeler">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200"><Route size={16} className="text-cyan-300" /> Lifecycle State Machine</div>
        <p className="mt-3 text-xs text-slate-500">Define a Rust enum for the contract lifecycle to generate a state machine.</p>
      </section>
    );
  }

  const width = Math.max(560, model.states.length * 170);
  const positions = model.states.map((state, index) => ({
    state,
    x: model.states.length === 1 ? width / 2 : 90 + (index * (width - 180)) / (model.states.length - 1),
    y: index % 2 === 0 ? 74 : 164,
  }));
  const positionById = new Map(positions.map((position) => [position.state.id, position]));

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5" aria-label="State machine modeler">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Route size={16} className="text-cyan-300" /> Lifecycle State Machine</div>
          <p className="mt-1 text-xs text-slate-500">{model.enumName} · {model.states.length} states · {model.transitions.length} transition triggers</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {contractId && fetchCurrentState && <button type="button" onClick={() => void refreshState()} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-50"><RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Reading ledger…" : "Refresh live state"}</button>}
          <button type="button" onClick={() => downloadFile("soroban-lifecycle.xstate.json", JSON.stringify(toXStateMachine(model), null, 2), "application/json")} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"><Download size={13} /> XState JSON</button>
          <button type="button" onClick={() => downloadFile("soroban-lifecycle.puml", toPlantUml(model), "text/plain")} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"><ExternalLink size={13} /> PlantUML</button>
        </div>
      </div>
      {refreshError && <p role="alert" className="mt-3 text-xs text-rose-300">{refreshError}</p>}
      <div className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/70 p-2">
        <div className="relative" style={{ width, minHeight: 240 }}>
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            <defs><marker id="state-machine-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#67e8f9" /></marker></defs>
            {model.transitions.map((transition) => {
              const from = positionById.get(transition.source) ?? positions[0];
              const to = positionById.get(transition.target);
              if (!to) return null;
              return <line key={transition.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={selected?.id === transition.id ? "#fbbf24" : "#67e8f9"} strokeWidth={selected?.id === transition.id ? 3 : 1.5} markerEnd="url(#state-machine-arrow)" />;
            })}
          </svg>
          {model.transitions.map((transition) => {
            const from = positionById.get(transition.source) ?? positions[0];
            const to = positionById.get(transition.target);
            if (!to) return null;
            const x = (from.x + to.x) / 2;
            const y = (from.y + to.y) / 2 - 10;
            return <button key={`edge-${transition.id}`} type="button" aria-label={`Select transition ${transition.functionName}`} onClick={() => selectTransition(transition)} className="absolute z-10 -translate-x-1/2 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-cyan-200 ring-1 ring-cyan-400/20 hover:bg-cyan-950" style={{ left: x, top: y }}>{transition.functionName}</button>;
          })}
          {positions.map(({ state, x, y }) => {
            const active = liveState === state.id;
            return <div key={state.id} className={`absolute z-20 w-32 -translate-x-1/2 -translate-y-1/2 rounded-xl border p-3 text-center shadow-lg ${active ? "border-emerald-300 bg-emerald-400/15 shadow-emerald-400/20" : state.initial ? "border-cyan-300/70 bg-cyan-400/10" : "border-white/15 bg-slate-900"}`} style={{ left: x, top: y }}><div className="text-xs font-semibold text-slate-100">{state.label}</div><div className="mt-1 flex justify-center gap-1 text-[9px] uppercase tracking-wider text-slate-500">{state.initial && <span>initial</span>}{active && <span className="text-emerald-300">live</span>}{state.terminal && <span>final</span>}</div></div>;
          })}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-400"><span className={`h-2 w-2 rounded-full ${liveState ? "bg-emerald-400" : "bg-slate-600"}`} /> {liveState ? `Live ledger state: ${liveState}` : "Live ledger state unavailable"}</div>
        {selected && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-amber-100"><Zap size={14} /> <span className="font-mono">{selected.functionName}()</span><button type="button" onClick={() => onInvoke?.(selected.functionName, selectedArgs)} disabled={!onInvoke} className="rounded bg-amber-300/20 px-2 py-1 font-semibold hover:bg-amber-300/30 disabled:cursor-not-allowed disabled:opacity-40">Prefill invocation</button></div>}
      </div>
      {selected && selected.inputs && selected.inputs.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{selected.inputs.map((input) => <label key={input.name} className="text-[11px] text-slate-400">{input.name} <input aria-label={`Transition argument ${input.name}`} value={String(selectedArgs[input.name] ?? "")} onChange={(event) => setSelectedArgs((previous) => ({ ...previous, [input.name]: event.target.value }))} className="mt-1 w-full rounded border border-white/10 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-200" /></label>)}</div>}
    </section>
  );
}
