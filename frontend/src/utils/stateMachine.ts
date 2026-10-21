import type { ContractAbiFunction } from "@/utils/contractAbi";

export interface StateMachineState {
  id: string;
  label: string;
  initial?: boolean;
  terminal?: boolean;
}

export interface StateMachineTransition {
  id: string;
  event: string;
  source: string;
  target: string;
  functionName: string;
  inputs: ContractAbiFunction["inputs"];
}

export interface StateMachineModel {
  enumName: string;
  states: StateMachineState[];
  transitions: StateMachineTransition[];
  initialState: string;
}

const RESERVED_VARIANTS = new Set(["None", "Some", "Ok", "Err"]);
const TERMINAL_NAMES = new Set(["liquidated", "closed", "completed", "finalized", "terminated"]);

function cleanSource(source: string): string {
  return source
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function pascalToEvent(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function findBalancedBlock(source: string, openingIndex: number): string {
  let depth = 0;
  for (let index = openingIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openingIndex + 1, index);
    }
  }
  return "";
}

function extractEnum(source: string): { name: string; body: string } | null {
  const match = source.match(/(?:pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/);
  if (!match || match.index === undefined) return null;
  const openingIndex = match.index + match[0].lastIndexOf("{");
  return { name: match[1], body: findBalancedBlock(source, openingIndex) };
}

function extractVariants(body: string): string[] {
  return body
    .split(",")
    .map((part) => part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\)|\{[^}]*\})?$/)?.[1])
    .filter((variant): variant is string => typeof variant === "string")
    .filter((variant) => !RESERVED_VARIANTS.has(variant));
}

function extractFunctions(source: string): Array<{ name: string; body: string }> {
  const functions: Array<{ name: string; body: string }> = [];
  const signature = /pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = signature.exec(source))) {
    const openingIndex = source.indexOf("{", match.index);
    functions.push({ name: match[1], body: findBalancedBlock(source, openingIndex) });
  }
  return functions;
}

function findTarget(body: string, variants: string[]): string | undefined {
  const candidates = variants.filter((variant) =>
    new RegExp(`(?:State|Lifecycle|Status)?::${variant}\\b`).test(body),
  );
  return candidates[0];
}

function findSource(body: string, variants: string[]): string | undefined {
  const match = body.match(/(?:State|Lifecycle|Status)::([A-Za-z_][A-Za-z0-9_]*)\s*=>/);
  if (match && variants.includes(match[1])) return match[1];
  return undefined;
}

function inferTargetFromFunction(functionName: string, variants: string[]): string | undefined {
  const normalized = functionName.toLowerCase();
  return variants.find((variant) => {
    const candidate = variant.toLowerCase();
    return normalized.includes(candidate) || candidate.includes(normalized.replace(/^(set|to|mark)/, ""));
  });
}

export function extractStateMachine(source: string, abi: ContractAbiFunction[] = []): StateMachineModel {
  const cleaned = cleanSource(source);
  const enumDefinition = extractEnum(cleaned);
  if (!enumDefinition) {
    return { enumName: "Lifecycle", states: [], transitions: [], initialState: "" };
  }
  const variants = extractVariants(enumDefinition.body);
  const initialState = variants.find((variant) => /initial|uninitialized|pending/i.test(variant)) ?? variants[0] ?? "";
  const functions = extractFunctions(cleaned);
  const transitions: StateMachineTransition[] = [];
  for (const fn of functions) {
    const target = findTarget(fn.body, variants) ?? inferTargetFromFunction(fn.name, variants);
    if (!target) continue;
    const sourceState = findSource(fn.body, variants) ?? "*";
    if (sourceState === target && sourceState !== "*") continue;
    const abiFunction = abi.find((entry) => entry.name === fn.name);
    transitions.push({
      id: `${fn.name}-${sourceState}-${target}`,
      event: pascalToEvent(fn.name),
      source: sourceState,
      target,
      functionName: fn.name,
      inputs: abiFunction?.inputs ?? [],
    });
  }
  return {
    enumName: enumDefinition.name,
    states: variants.map((id) => ({
      id,
      label: id.replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
      initial: id === initialState,
      terminal: TERMINAL_NAMES.has(id.toLowerCase()),
    })),
    transitions,
    initialState,
  };
}

export interface XStateMachineDefinition {
  id: string;
  initial: string;
  states: Record<string, { type?: "final"; on?: Record<string, { target: string; meta?: { functionName: string; inputs: string[] } }> }>;
}

export function toXStateMachine(model: StateMachineModel, id = "sorobanLifecycle"): XStateMachineDefinition {
  const states: XStateMachineDefinition["states"] = {};
  for (const state of model.states) {
    states[state.id] = {
      ...(state.terminal ? { type: "final" as const } : {}),
      ...(model.transitions.some((transition) => transition.source === state.id || transition.source === "*")
        ? { on: {} }
        : {}),
    };
  }
  for (const transition of model.transitions) {
    const sourceStates = transition.source === "*" ? model.states.map((state) => state.id) : [transition.source];
    for (const source of sourceStates) {
      states[source] ??= { on: {} };
      states[source].on ??= {};
      states[source].on[transition.event] = {
        target: `#${id}.${transition.target}`,
        meta: { functionName: transition.functionName, inputs: (transition.inputs ?? []).map((input) => `${input.name}: ${input.type}`) },
      };
    }
  }
  return { id, initial: model.initialState, states };
}

export function toPlantUml(model: StateMachineModel): string {
  const lines = ["@startuml", "hide empty description", `[*] --> ${model.initialState}`];
  for (const transition of model.transitions) lines.push(`${transition.source === "*" ? "[*]" : transition.source} --> ${transition.target} : ${transition.functionName}`);
  for (const state of model.states.filter((entry) => entry.terminal)) lines.push(`${state.id} --> [*]`);
  return [...lines, "@enduml"].join("\n");
}
