"use client";

import React, { useState, useMemo } from "react";
import {
  Boxes,
  Code2,
  Copy,
  Check,
  Plus,
  Trash2,
  Lock,
  Radio,
  Calculator,
  Database,
  ArrowRight,
  FileCode,
  HelpCircle,
  Columns,
} from "lucide-react";

// ── Types & Interfaces ────────────────────────────────────────────────────────

export type SorobanType =
  | "Address"
  | "i128"
  | "u32"
  | "u64"
  | "Symbol"
  | "String"
  | "bool"
  | "BytesN32"
  | "void";

export type StorageDomain = "instance" | "persistent" | "temporary";

export type BlockCategory = "state" | "function" | "auth" | "event" | "math" | "storage" | "control";

export interface StateVariable {
  id: string;
  name: string;
  type: SorobanType;
  domain: StorageDomain;
  defaultValue?: string;
}

export interface StatementBlock {
  id: string;
  type:
    | "auth_check"
    | "storage_get"
    | "storage_set"
    | "math_op"
    | "event_publish"
    | "if_condition"
    | "return_statement";
  label: string;
  params: Record<string, string>;
}

export interface FunctionBlock {
  id: string;
  name: string;
  isView: boolean;
  parameters: Array<{ name: string; type: SorobanType }>;
  returnType: SorobanType;
  statements: StatementBlock[];
}

export interface ContractAST {
  contractName: string;
  stateVariables: StateVariable[];
  functions: FunctionBlock[];
}

export interface LogicBlockCanvasProps {
  initialAST?: ContractAST;
  onChangeCode?: (rustCode: string) => void;
  onSendToEditor?: (rustCode: string) => void;
  className?: string;
}

// ── Type Compatibility System ─────────────────────────────────────────────────

export const TYPE_COLORS: Record<SorobanType, { bg: string; border: string; text: string }> = {
  Address: { bg: "bg-blue-500/15", border: "border-blue-500/40", text: "text-blue-400" },
  i128: { bg: "bg-emerald-500/15", border: "border-emerald-500/40", text: "text-emerald-400" },
  u32: { bg: "bg-cyan-500/15", border: "border-cyan-500/40", text: "text-cyan-400" },
  u64: { bg: "bg-teal-500/15", border: "border-teal-500/40", text: "text-teal-400" },
  Symbol: { bg: "bg-purple-500/15", border: "border-purple-500/40", text: "text-purple-400" },
  String: { bg: "bg-pink-500/15", border: "border-pink-500/40", text: "text-pink-400" },
  bool: { bg: "bg-amber-500/15", border: "border-amber-500/40", text: "text-amber-400" },
  BytesN32: { bg: "bg-indigo-500/15", border: "border-indigo-500/40", text: "text-indigo-400" },
  void: { bg: "bg-slate-500/15", border: "border-slate-500/40", text: "text-slate-400" },
};

/**
 * Validates type-safe connections between block sockets.
 * Prevents connecting e.g. Address to an arithmetic u32/i128 slot.
 */
export function canConnectTypes(source: SorobanType, targetAccepted: SorobanType[]): boolean {
  if (targetAccepted.includes(source)) return true;
  // Numeric coercion rules
  if ((source === "u32" || source === "u64") && targetAccepted.includes("i128")) return true;
  return false;
}

function rustType(type: SorobanType): string {
  if (type === "BytesN32") return "soroban_sdk::BytesN<32>";
  if (type === "void") return "()";
  return type;
}

function rustIdentifier(value: string, fallback: string): string {
  const identifier = value.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier) && !["self", "Self", "super", "crate"].includes(identifier)
    ? identifier
    : fallback;
}

const NUMERIC_TYPES: SorobanType[] = ["i128", "u32", "u64"];

interface TypedExpression {
  expression: string;
  type: SorobanType;
}

function getNumericExpressions(
  fn: FunctionBlock,
  stateVariables: StateVariable[],
  beforeStatement: number,
): TypedExpression[] {
  const values: TypedExpression[] = fn.parameters
    .filter((parameter) => NUMERIC_TYPES.includes(parameter.type))
    .map((parameter) => ({ expression: parameter.name, type: parameter.type }));

  const priorStatements = fn.statements.slice(0, beforeStatement);
  for (const statement of priorStatements) {
    if (statement.type === "storage_get") {
      const state = stateVariables.find(
        (variable) => variable.name.toUpperCase() === (statement.params.key || "").toUpperCase(),
      );
      if (state && NUMERIC_TYPES.includes(state.type)) {
        values.push({ expression: statement.params.varName || "val", type: state.type });
      }
    }
    if (statement.type === "math_op") {
      const left = values.find((value) => value.expression === statement.params.left);
      if (left) values.push({ expression: statement.params.resultVar || "result", type: left.type });
    }
  }

  values.push(
    { expression: "0_i128", type: "i128" },
    { expression: "1_i128", type: "i128" },
    { expression: "0_u32", type: "u32" },
    { expression: "1_u32", type: "u32" },
    { expression: "0_u64", type: "u64" },
    { expression: "1_u64", type: "u64" },
  );
  return values.filter((value, index) => values.findIndex((candidate) => candidate.expression === value.expression) === index);
}

function safeNumericExpression(expression: string, fallback: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(expression) || /^-?\d+_(i128|u32|u64)$/.test(expression)
    ? expression
    : fallback;
}

// ── Rust Code Generator Engine ────────────────────────────────────────────────

/**
 * Generates clean, idiomatic, compilable Soroban Rust smart contract code from the AST.
 */
export function generateSorobanRustCode(ast: ContractAST): string {
  const lines: string[] = [];
  const contractName = rustIdentifier(ast.contractName, "GeneratedContract");

  // Preamble & Imports
  lines.push("#![no_std]");
  lines.push("use soroban_sdk::{");
  lines.push("    contract, contractimpl, symbol_short, Address, Env, String, Symbol,");
  lines.push("};");
  lines.push("");

  // Storage Key Constants
  if (ast.stateVariables.length > 0) {
    lines.push("// ── Storage Key Symbols ──────────────────────────────────────────────");
    for (const sv of ast.stateVariables) {
      const symName = rustIdentifier(sv.name.toUpperCase(), "STATE_KEY");
      const shortSym = symName.length <= 9 ? symName : symName.slice(0, 9);
      lines.push(`const ${symName}: Symbol = symbol_short!("${shortSym}");`);
    }
    lines.push("");
  }

  // Contract Struct
  lines.push(`#[contract]`);
  lines.push(`pub struct ${contractName};`);
  lines.push("");

  // Contract Implementation
  lines.push(`#[contractimpl]`);
  lines.push(`impl ${contractName} {`);

  // Functions
  ast.functions.forEach((fn, idx) => {
    if (idx > 0) lines.push("");

    // Build parameter signature
    const paramList = ["env: Env"];
    fn.parameters.forEach((p) => {
      paramList.push(`${rustIdentifier(p.name, "value")}: ${rustType(p.type)}`);
    });

    const returnSig = fn.returnType !== "void" ? ` -> ${rustType(fn.returnType)}` : "";
    lines.push(`    pub fn ${rustIdentifier(fn.name, "action")}(${paramList.join(", ")})${returnSig} {`);

    if (fn.statements.length === 0) {
      if (fn.returnType === "bool") lines.push("        true");
      else if (fn.returnType === "i128" || fn.returnType === "u32" || fn.returnType === "u64")
        lines.push(`        0_${fn.returnType}`);
      else if (fn.returnType !== "void") lines.push('        panic!("Return value is not configured")');
    } else {
      fn.statements.forEach((stmt, statementIndex) => {
        switch (stmt.type) {
          case "auth_check": {
            const caller = rustIdentifier(stmt.params.caller || "caller", "caller");
            lines.push(`        // Ensure cryptographic authorization from ${caller}`);
            lines.push(`        ${caller}.require_auth();`);
            break;
          }

          case "storage_get": {
            const domain = ["instance", "persistent", "temporary"].includes(stmt.params.domain || "") ? stmt.params.domain : "instance";
            const key = rustIdentifier((stmt.params.key || "KEY").toUpperCase(), "STATE_KEY");
            const varName = rustIdentifier(stmt.params.varName || "val", "val");
            const fallback = stmt.params.fallback || "0";
            lines.push(
              `        let ${varName} = env.storage().${domain}().get(&${key}).unwrap_or(${fallback});`
            );
            break;
          }

          case "storage_set": {
            const domain = ["instance", "persistent", "temporary"].includes(stmt.params.domain || "") ? stmt.params.domain : "instance";
            const key = rustIdentifier((stmt.params.key || "KEY").toUpperCase(), "STATE_KEY");
            const val = stmt.params.value || "0";
            lines.push(`        env.storage().${domain}().set(&${key}, &${val});`);
            break;
          }

          case "math_op": {
            const resVar = rustIdentifier(stmt.params.resultVar || "result", "result");
            const left = safeNumericExpression(stmt.params.left || "0_i128", "0_i128");
            const op = ["checked_add", "checked_sub", "checked_mul", "checked_div"].includes(stmt.params.op || "") ? stmt.params.op : "checked_add";
            const right = safeNumericExpression(stmt.params.right || "0_i128", "0_i128");
            const numericValues = getNumericExpressions(fn, ast.stateVariables, statementIndex);
            const leftType = numericValues.find((value) => value.expression === left)?.type;
            const rightType = numericValues.find((value) => value.expression === right)?.type;
            const rightOperand = leftType === "i128" && (rightType === "u32" || rightType === "u64")
              ? `i128::from(${right})`
              : right;
            lines.push(
              `        let ${resVar} = ${left}.${op}(${rightOperand}).expect("arithmetic overflow");`
            );
            break;
          }

          case "event_publish": {
            const topic = (stmt.params.topic || "EVENT").toUpperCase();
            const shortTopic = (topic.replace(/[^A-Z0-9_]/g, "_").slice(0, 9) || "EVENT");
            const data = stmt.params.data || "data";
            lines.push(
              `        env.events().publish((symbol_short!("${shortTopic}"),), ${data});`
            );
            break;
          }

          case "if_condition": {
            const cond = stmt.params.condition || "true";
            const body = stmt.params.body || "return;";
            lines.push(`        if ${cond} {`);
            lines.push(`            ${body}`);
            lines.push(`        }`);
            break;
          }

          case "return_statement": {
            const val = stmt.params.value || "()";
            lines.push(`        ${val}`);
            break;
          }
        }
      });
    }

    lines.push("    }");
  });

  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

// ── Templates ─────────────────────────────────────────────────────────────────

export const TEMPLATE_TOKEN: ContractAST = {
  contractName: "TokenContract",
  stateVariables: [
    { id: "sv-admin", name: "ADMIN", type: "Address", domain: "instance" },
    { id: "sv-supply", name: "SUPPLY", type: "i128", domain: "instance", defaultValue: "0" },
  ],
  functions: [
    {
      id: "fn-init",
      name: "initialize",
      isView: false,
      parameters: [{ name: "admin", type: "Address" }],
      returnType: "void",
      statements: [
        {
          id: "s-init-auth",
          type: "auth_check",
          label: "Require Admin Auth",
          params: { caller: "admin" },
        },
        {
          id: "s-init-set-admin",
          type: "storage_set",
          label: "Save Admin Address",
          params: { domain: "instance", key: "ADMIN", value: "admin" },
        },
        {
          id: "s-init-set-supply",
          type: "storage_set",
          label: "Init Total Supply",
          params: { domain: "instance", key: "SUPPLY", value: "0_i128" },
        },
      ],
    },
    {
      id: "fn-mint",
      name: "mint",
      isView: false,
      parameters: [
        { name: "admin", type: "Address" },
        { name: "to", type: "Address" },
        { name: "amount", type: "i128" },
      ],
      returnType: "i128",
      statements: [
        {
          id: "s-mint-auth",
          type: "auth_check",
          label: "Require Admin Auth",
          params: { caller: "admin" },
        },
        {
          id: "s-mint-get-sup",
          type: "storage_get",
          label: "Get Current Supply",
          params: { domain: "instance", key: "SUPPLY", varName: "current_supply", fallback: "0_i128" },
        },
        {
          id: "s-mint-math",
          type: "math_op",
          label: "Add Mint Amount",
          params: { resultVar: "new_supply", left: "current_supply", op: "checked_add", right: "amount" },
        },
        {
          id: "s-mint-set-sup",
          type: "storage_set",
          label: "Update Total Supply",
          params: { domain: "instance", key: "SUPPLY", value: "new_supply" },
        },
        {
          id: "s-mint-event",
          type: "event_publish",
          label: "Publish Mint Event",
          params: { topic: "MINT", data: "amount" },
        },
        {
          id: "s-mint-ret",
          type: "return_statement",
          label: "Return New Supply",
          params: { value: "new_supply" },
        },
      ],
    },
    {
      id: "fn-get-supply",
      name: "get_total_supply",
      isView: true,
      parameters: [],
      returnType: "i128",
      statements: [
        {
          id: "s-sup-get",
          type: "storage_get",
          label: "Read Total Supply",
          params: { domain: "instance", key: "SUPPLY", varName: "supply", fallback: "0_i128" },
        },
        {
          id: "s-sup-ret",
          type: "return_statement",
          label: "Return Supply",
          params: { value: "supply" },
        },
      ],
    },
  ],
};

export const TEMPLATE_ESCROW: ContractAST = {
  contractName: "EscrowContract",
  stateVariables: [
    { id: "sv-arbiter", name: "ARBITER", type: "Address", domain: "instance" },
    { id: "sv-beneficiary", name: "BENEFICIARY", type: "Address", domain: "instance" },
    { id: "sv-amount", name: "AMOUNT", type: "i128", domain: "instance" },
    { id: "sv-released", name: "RELEASED", type: "bool", domain: "instance", defaultValue: "false" },
  ],
  functions: [
    {
      id: "fn-deposit",
      name: "deposit",
      isView: false,
      parameters: [
        { name: "depositor", type: "Address" },
        { name: "arbiter", type: "Address" },
        { name: "beneficiary", type: "Address" },
        { name: "amount", type: "i128" },
      ],
      returnType: "void",
      statements: [
        {
          id: "s-dep-auth",
          type: "auth_check",
          label: "Require Depositor Auth",
          params: { caller: "depositor" },
        },
        {
          id: "s-dep-set-arb",
          type: "storage_set",
          label: "Set Arbiter",
          params: { domain: "instance", key: "ARBITER", value: "arbiter" },
        },
        {
          id: "s-dep-set-ben",
          type: "storage_set",
          label: "Set Beneficiary",
          params: { domain: "instance", key: "BENEFICIARY", value: "beneficiary" },
        },
        {
          id: "s-dep-set-amt",
          type: "storage_set",
          label: "Set Amount",
          params: { domain: "instance", key: "AMOUNT", value: "amount" },
        },
        {
          id: "s-dep-event",
          type: "event_publish",
          label: "Publish Escrow Event",
          params: { topic: "DEPOSITED", data: "amount" },
        },
      ],
    },
    {
      id: "fn-release",
      name: "release",
      isView: false,
      parameters: [{ name: "arbiter", type: "Address" }],
      returnType: "bool",
      statements: [
        {
          id: "s-rel-auth",
          type: "auth_check",
          label: "Require Arbiter Auth",
          params: { caller: "arbiter" },
        },
        {
          id: "s-rel-set",
          type: "storage_set",
          label: "Mark Released",
          params: { domain: "instance", key: "RELEASED", value: "true" },
        },
        {
          id: "s-rel-event",
          type: "event_publish",
          label: "Publish Release Event",
          params: { topic: "RELEASED", data: "true" },
        },
        {
          id: "s-rel-ret",
          type: "return_statement",
          label: "Return Status",
          params: { value: "true" },
        },
      ],
    },
  ],
};

export const TEMPLATE_STAKING: ContractAST = {
  contractName: "StakingContract",
  stateVariables: [
    { id: "sv-rate", name: "REWARD_RATE", type: "u32", domain: "instance", defaultValue: "500" },
    { id: "sv-total-staked", name: "TOTAL_STAKED", type: "i128", domain: "instance", defaultValue: "0" },
  ],
  functions: [
    {
      id: "fn-stake",
      name: "stake",
      isView: false,
      parameters: [
        { name: "user", type: "Address" },
        { name: "amount", type: "i128" },
      ],
      returnType: "i128",
      statements: [
        {
          id: "s-stk-auth",
          type: "auth_check",
          label: "Require User Auth",
          params: { caller: "user" },
        },
        {
          id: "s-stk-get-tot",
          type: "storage_get",
          label: "Read Total Staked",
          params: { domain: "instance", key: "TOTAL_STAKED", varName: "total", fallback: "0_i128" },
        },
        {
          id: "s-stk-add",
          type: "math_op",
          label: "Add Stake Amount",
          params: { resultVar: "new_total", left: "total", op: "checked_add", right: "amount" },
        },
        {
          id: "s-stk-set",
          type: "storage_set",
          label: "Update Total Staked",
          params: { domain: "instance", key: "TOTAL_STAKED", value: "new_total" },
        },
        {
          id: "s-stk-event",
          type: "event_publish",
          label: "Publish Stake Event",
          params: { topic: "STAKED", data: "amount" },
        },
        {
          id: "s-stk-ret",
          type: "return_statement",
          label: "Return Staked Total",
          params: { value: "new_total" },
        },
      ],
    },
  ],
};

export const TEMPLATE_MULTISIG: ContractAST = {
  contractName: "MultisigContract",
  stateVariables: [
    { id: "sv-thresh", name: "THRESHOLD", type: "u32", domain: "instance", defaultValue: "2" },
    { id: "sv-nonce", name: "NONCE", type: "u32", domain: "instance", defaultValue: "0" },
  ],
  functions: [
    {
      id: "fn-exec",
      name: "execute_proposal",
      isView: false,
      parameters: [
        { name: "signer_a", type: "Address" },
        { name: "signer_b", type: "Address" },
      ],
      returnType: "bool",
      statements: [
        {
          id: "s-ms-auth-a",
          type: "auth_check",
          label: "Require Signer A Auth",
          params: { caller: "signer_a" },
        },
        {
          id: "s-ms-auth-b",
          type: "auth_check",
          label: "Require Signer B Auth",
          params: { caller: "signer_b" },
        },
        {
          id: "s-ms-nonce-get",
          type: "storage_get",
          label: "Read Nonce",
          params: { domain: "instance", key: "NONCE", varName: "nonce", fallback: "0_u32" },
        },
        {
          id: "s-ms-nonce-inc",
          type: "math_op",
          label: "Increment Nonce",
          params: { resultVar: "next_nonce", left: "nonce", op: "checked_add", right: "1_u32" },
        },
        {
          id: "s-ms-nonce-set",
          type: "storage_set",
          label: "Store Nonce",
          params: { domain: "instance", key: "NONCE", value: "next_nonce" },
        },
        {
          id: "s-ms-event",
          type: "event_publish",
          label: "Publish Execution Event",
          params: { topic: "EXECUTED", data: "next_nonce" },
        },
        {
          id: "s-ms-ret",
          type: "return_statement",
          label: "Return Success",
          params: { value: "true" },
        },
      ],
    },
  ],
};

// ── Component Implementation ──────────────────────────────────────────────────

export default function LogicBlockCanvas({
  initialAST = TEMPLATE_TOKEN,
  onChangeCode,
  onSendToEditor,
  className = "",
}: LogicBlockCanvasProps) {
  const [ast, setAst] = useState<ContractAST>(initialAST);
  const [activeTab, setActiveTab] = useState<"canvas" | "split" | "code">("split");
  const [selectedFunctionId, setSelectedFunctionId] = useState<string>(
    initialAST.functions[0]?.id || ""
  );
  const [copied, setCopied] = useState<boolean>(false);
  const [draggedBlockType, setDraggedBlockType] = useState<string | null>(null);

  // Active Function resolution
  const activeFunction = useMemo(
    () => ast.functions.find((f) => f.id === selectedFunctionId) || ast.functions[0],
    [ast, selectedFunctionId]
  );

  // Generate Soroban Rust code from current AST
  const generatedRustCode = useMemo(() => {
    return generateSorobanRustCode(ast);
  }, [ast]);

  // Notify parent on code change
  React.useEffect(() => {
    if (onChangeCode) {
      onChangeCode(generatedRustCode);
    }
  }, [generatedRustCode, onChangeCode]);

  // Load a template preset
  const handleLoadTemplate = (templateName: "token" | "escrow" | "staking" | "multisig") => {
    let chosen: ContractAST;
    switch (templateName) {
      case "token":
        chosen = TEMPLATE_TOKEN;
        break;
      case "escrow":
        chosen = TEMPLATE_ESCROW;
        break;
      case "staking":
        chosen = TEMPLATE_STAKING;
        break;
      case "multisig":
        chosen = TEMPLATE_MULTISIG;
        break;
    }
    setAst(JSON.parse(JSON.stringify(chosen)) as ContractAST);
    setSelectedFunctionId(chosen.functions[0]?.id || "");
  };

  // Add a new statement block into current function
  const handleAddStatement = (type: StatementBlock["type"]) => {
    if (!activeFunction) return;

    let newStmt: StatementBlock;
    const uid = `stmt-${Date.now()}`;

    switch (type) {
      case "auth_check":
        newStmt = {
          id: uid,
          type: "auth_check",
          label: "Require Auth",
          params: { caller: "caller" },
        };
        break;
      case "storage_get":
        newStmt = {
          id: uid,
          type: "storage_get",
          label: "Storage Get",
          params: { domain: "instance", key: "VAR", varName: "val", fallback: "0" },
        };
        break;
      case "storage_set":
        newStmt = {
          id: uid,
          type: "storage_set",
          label: "Storage Set",
          params: { domain: "instance", key: "VAR", value: "val" },
        };
        break;
      case "math_op":
        newStmt = {
          id: uid,
          type: "math_op",
          label: "Checked Math",
          params: { resultVar: "res", left: "0_i128", op: "checked_add", right: "0_i128" },
        };
        break;
      case "event_publish":
        newStmt = {
          id: uid,
          type: "event_publish",
          label: "Publish Event",
          params: { topic: "TOPIC", data: "amount" },
        };
        break;
      case "if_condition":
        newStmt = {
          id: uid,
          type: "if_condition",
          label: "If Condition",
          params: { condition: "amount > 0", body: "return true;" },
        };
        break;
      case "return_statement":
        newStmt = {
          id: uid,
          type: "return_statement",
          label: "Return Value",
          params: { value: "true" },
        };
        break;
    }

    setAst((prev) => ({
      ...prev,
      functions: prev.functions.map((fn) =>
        fn.id === activeFunction.id
          ? { ...fn, statements: [...fn.statements, newStmt] }
          : fn
      ),
    }));
  };

  const handlePaletteDragStart = (event: React.DragEvent<HTMLButtonElement>, type: StatementBlock["type"]) => {
    setDraggedBlockType(type);
    event.dataTransfer.setData("application/x-soroban-block", type);
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleCanvasDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/x-soroban-block") || draggedBlockType;
    if (type && ["auth_check", "storage_get", "storage_set", "math_op", "event_publish", "if_condition", "return_statement"].includes(type)) {
      handleAddStatement(type as StatementBlock["type"]);
    }
    setDraggedBlockType(null);
  };

  // Delete a statement block
  const handleDeleteStatement = (stmtId: string) => {
    if (!activeFunction) return;
    setAst((prev) => ({
      ...prev,
      functions: prev.functions.map((fn) =>
        fn.id === activeFunction.id
          ? { ...fn, statements: fn.statements.filter((s) => s.id !== stmtId) }
          : fn
      ),
    }));
  };

  // Update a statement block parameter
  const handleUpdateStatementParam = (stmtId: string, paramKey: string, val: string) => {
    if (!activeFunction) return;
    setAst((prev) => ({
      ...prev,
      functions: prev.functions.map((fn) =>
        fn.id === activeFunction.id
          ? {
              ...fn,
              statements: fn.statements.map((s) =>
                s.id === stmtId
                  ? { ...s, params: { ...s.params, [paramKey]: val } }
                  : s
              ),
            }
          : fn
      ),
    }));
  };

  // Add a new function
  const handleAddFunction = () => {
    const newFn: FunctionBlock = {
      id: `fn-${Date.now()}`,
      name: `action_${ast.functions.length + 1}`,
      isView: false,
      parameters: [{ name: "caller", type: "Address" }],
      returnType: "bool",
      statements: [
        {
          id: `stmt-${Date.now()}-auth`,
          type: "auth_check",
          label: "Require Auth",
          params: { caller: "caller" },
        },
        {
          id: `stmt-${Date.now()}-ret`,
          type: "return_statement",
          label: "Return",
          params: { value: "true" },
        },
      ],
    };
    setAst((prev) => ({ ...prev, functions: [...prev.functions, newFn] }));
    setSelectedFunctionId(newFn.id);
  };

  // Copy code to clipboard
  const handleCopyCode = () => {
    void Promise.resolve(navigator.clipboard.writeText(generatedRustCode)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => setCopied(false));
  };

  return (
    <div
      className={`w-full bg-slate-950 border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden ${className}`}
      data-testid="logic-block-canvas"
    >
      {/* ── Top Control Bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Boxes className="w-5 h-5 text-primary-400" />
            <h2 className="text-sm font-semibold tracking-wide text-white uppercase">
              Soroban Logic Block Builder
            </h2>
          </div>

          {/* Template Selectors */}
          <div className="flex items-center gap-1.5 pl-3 border-l border-slate-800">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 mr-1">
              Templates:
            </span>
            <button
              onClick={() => handleLoadTemplate("token")}
              className="px-2.5 py-1 rounded text-xs font-medium bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition"
              data-testid="template-btn-token"
            >
              Token
            </button>
            <button
              onClick={() => handleLoadTemplate("escrow")}
              className="px-2.5 py-1 rounded text-xs font-medium bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition"
              data-testid="template-btn-escrow"
            >
              Escrow
            </button>
            <button
              onClick={() => handleLoadTemplate("staking")}
              className="px-2.5 py-1 rounded text-xs font-medium bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition"
              data-testid="template-btn-staking"
            >
              Staking
            </button>
            <button
              onClick={() => handleLoadTemplate("multisig")}
              className="px-2.5 py-1 rounded text-xs font-medium bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition"
              data-testid="template-btn-multisig"
            >
              Multisig
            </button>
          </div>
        </div>

        {/* View Mode Tabs & Code Actions */}
        <div className="flex items-center gap-2">
          <div className="flex items-center p-0.5 rounded-lg bg-slate-950 border border-slate-800">
            <button
              onClick={() => setActiveTab("canvas")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
                activeTab === "canvas" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Boxes className="w-3.5 h-3.5" />
              Blocks Only
            </button>
            <button
              onClick={() => setActiveTab("split")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
                activeTab === "split" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              Split View
            </button>
            <button
              onClick={() => setActiveTab("code")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
                activeTab === "code" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              Rust Code
            </button>
          </div>

          <button
            onClick={handleCopyCode}
            aria-label="Copy generated Rust code"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-700 transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "Copied" : "Copy Code"}</span>
          </button>

          {onSendToEditor && (
            <button
              onClick={() => onSendToEditor(generatedRustCode)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-600 text-white hover:bg-primary-500 shadow-md shadow-primary-600/30 transition"
              data-testid="send-to-editor-btn"
            >
              <FileCode className="w-3.5 h-3.5" />
              Send to Editor
            </button>
          )}
        </div>
      </div>

      {/* ── Main Workspace Body ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col md:flex-row min-h-[580px]">
        {/* Left: Interactive Blocks Canvas (Shown in canvas and split modes) */}
        {(activeTab === "canvas" || activeTab === "split") && (
          <div
            className={`flex-1 flex flex-col bg-slate-950/60 p-4 border-r border-slate-800 overflow-y-auto ${
              activeTab === "canvas" ? "w-full" : "md:w-1/2"
            }`}
          >
            {/* Function Navigation Bar */}
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800/80">
              <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 mr-1">
                  Functions:
                </span>
                {ast.functions.map((fn) => (
                  <button
                    key={fn.id}
                    onClick={() => setSelectedFunctionId(fn.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition ${
                      fn.id === activeFunction?.id
                        ? "bg-primary-600 text-white shadow"
                        : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
                    }`}
                  >
                    fn {fn.name}()
                  </button>
                ))}
                <button
                  onClick={handleAddFunction}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-slate-900 border border-dashed border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition"
                >
                  <Plus className="w-3 h-3" />
                  Add Function
                </button>
              </div>

              <div className="text-[11px] font-mono text-slate-400">
                Contract: <span className="text-white font-semibold">{ast.contractName}</span>
              </div>
            </div>

            {/* Block Construction Palette */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-3 mb-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-2">
                Snap In Logic Blocks:
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  draggable
                  onDragStart={(event) => handlePaletteDragStart(event, "auth_check")}
                  onClick={() => handleAddStatement("auth_check")}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-blue-950/40 border border-blue-600/40 text-blue-300 hover:bg-blue-900/40 text-xs font-medium transition"
                  data-testid="add-block-auth"
                >
                  <Lock className="w-3.5 h-3.5 text-blue-400" />
                  Require Auth
                </button>
                <button
                  draggable
                  onDragStart={(event) => handlePaletteDragStart(event, "storage_get")}
                  onClick={() => handleAddStatement("storage_get")}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-amber-950/40 border border-amber-600/40 text-amber-300 hover:bg-amber-900/40 text-xs font-medium transition"
                  data-testid="add-block-storage-get"
                >
                  <Database className="w-3.5 h-3.5 text-amber-400" />
                  Storage Get
                </button>
                <button
                  draggable
                  onDragStart={(event) => handlePaletteDragStart(event, "storage_set")}
                  onClick={() => handleAddStatement("storage_set")}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-amber-950/40 border border-amber-600/40 text-amber-300 hover:bg-amber-900/40 text-xs font-medium transition"
                  data-testid="add-block-storage-set"
                >
                  <Database className="w-3.5 h-3.5 text-amber-400" />
                  Storage Set
                </button>
                <button
                  draggable
                  onDragStart={(event) => handlePaletteDragStart(event, "math_op")}
                  onClick={() => handleAddStatement("math_op")}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-emerald-950/40 border border-emerald-600/40 text-emerald-300 hover:bg-emerald-900/40 text-xs font-medium transition"
                  data-testid="add-block-math"
                >
                  <Calculator className="w-3.5 h-3.5 text-emerald-400" />
                  Checked Math
                </button>
                <button
                  draggable
                  onDragStart={(event) => handlePaletteDragStart(event, "event_publish")}
                  onClick={() => handleAddStatement("event_publish")}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-purple-950/40 border border-purple-600/40 text-purple-300 hover:bg-purple-900/40 text-xs font-medium transition"
                  data-testid="add-block-event"
                >
                  <Radio className="w-3.5 h-3.5 text-purple-400" />
                  Publish Event
                </button>
                <button
                  draggable
                  onDragStart={(event) => handlePaletteDragStart(event, "if_condition")}
                  onClick={() => handleAddStatement("if_condition")}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-amber-950/40 border border-amber-600/40 text-amber-300 hover:bg-amber-900/40 text-xs font-medium transition"
                  data-testid="add-block-condition"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
                  If Condition
                </button>
                <button
                  draggable
                  onDragStart={(event) => handlePaletteDragStart(event, "return_statement")}
                  onClick={() => handleAddStatement("return_statement")}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-medium transition"
                  data-testid="add-block-return"
                >
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  Return
                </button>
              </div>
            </div>

            {/* Active Function Statements Stack */}
            {activeFunction && (
              <div
                className={`space-y-3 rounded-lg ${draggedBlockType ? "ring-1 ring-primary-500/60" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleCanvasDrop}
                data-testid="block-drop-target"
              >
                {/* Function Header Node */}
                <div className="rounded-xl border border-primary-500/50 bg-primary-950/20 p-3 shadow-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-primary-300 flex items-center gap-1.5">
                      <Code2 className="w-4 h-4 text-primary-400" />
                      Function Scope: {activeFunction.name}()
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-primary-900/40 text-primary-300 border border-primary-700/40">
                      Returns: {activeFunction.returnType}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                    <span>Parameters:</span>
                    {activeFunction.parameters.length > 0 ? (
                      activeFunction.parameters.map((p, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-200"
                        >
                          {p.name}: <span className="text-primary-400">{p.type}</span>
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-500 italic">None</span>
                    )}
                  </div>
                </div>

                {/* Statements List */}
                {activeFunction.statements.map((stmt, statementIndex) => (
                  <div
                    key={stmt.id}
                    className="relative pl-6 before:absolute before:left-2.5 before:top-0 before:bottom-0 before:w-0.5 before:bg-slate-800 group"
                    data-testid={`statement-block-${stmt.type}`}
                  >
                    {/* Snap Connector Point */}
                    <div className="absolute left-1 top-4 w-3.5 h-3.5 rounded-full bg-slate-800 border-2 border-slate-600 flex items-center justify-center text-[8px] text-slate-400">
                      •
                    </div>

                    <div className="rounded-lg border border-slate-800 bg-slate-900/80 hover:border-slate-700 p-3 transition shadow-md">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold flex items-center gap-1.5 text-white">
                          {stmt.type === "auth_check" && <Lock className="w-3.5 h-3.5 text-blue-400" />}
                          {stmt.type === "storage_get" && <Database className="w-3.5 h-3.5 text-amber-400" />}
                          {stmt.type === "storage_set" && <Database className="w-3.5 h-3.5 text-amber-400" />}
                          {stmt.type === "math_op" && <Calculator className="w-3.5 h-3.5 text-emerald-400" />}
                          {stmt.type === "event_publish" && <Radio className="w-3.5 h-3.5 text-purple-400" />}
                          {stmt.type === "return_statement" && <ArrowRight className="w-3.5 h-3.5 text-slate-400" />}
                          {stmt.label}
                        </span>

                        <button
                          onClick={() => handleDeleteStatement(stmt.id)}
                          aria-label="Delete block"
                          className="text-slate-500 hover:text-red-400 transition p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Statement Parameters Editor Form */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {stmt.type === "auth_check" && (
                          <div>
                            <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">
                              Caller Address
                            </label>
                            <input
                              type="text"
                              value={stmt.params.caller || ""}
                              onChange={(e) =>
                                handleUpdateStatementParam(stmt.id, "caller", e.target.value)
                              }
                              className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        )}

                        {stmt.type === "storage_get" && (
                          <>
                            <div>
                              <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">
                                Storage Key
                              </label>
                              <input
                                type="text"
                                value={stmt.params.key || ""}
                                onChange={(e) =>
                                  handleUpdateStatementParam(stmt.id, "key", e.target.value)
                                }
                                className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">
                                Assigned Variable
                              </label>
                              <input
                                type="text"
                                value={stmt.params.varName || ""}
                                onChange={(e) =>
                                  handleUpdateStatementParam(stmt.id, "varName", e.target.value)
                                }
                                className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                              />
                            </div>
                          </>
                        )}

                        {stmt.type === "storage_set" && (
                          <>
                            <div>
                              <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">
                                Storage Key
                              </label>
                              <input
                                type="text"
                                value={stmt.params.key || ""}
                                onChange={(e) =>
                                  handleUpdateStatementParam(stmt.id, "key", e.target.value)
                                }
                                className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">
                                Value Expression
                              </label>
                              <input
                                type="text"
                                value={stmt.params.value || ""}
                                onChange={(e) =>
                                  handleUpdateStatementParam(stmt.id, "value", e.target.value)
                                }
                                className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                              />
                            </div>
                          </>
                        )}

                        {stmt.type === "math_op" && (
                          <>
                            <div>
                              <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">
                                Result Variable
                              </label>
                              <input
                                type="text"
                                value={stmt.params.resultVar || ""}
                                onChange={(e) =>
                                  handleUpdateStatementParam(stmt.id, "resultVar", e.target.value)
                                }
                                className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">
                                Operation
                              </label>
                              <select
                                value={stmt.params.op || "checked_add"}
                                onChange={(e) =>
                                  handleUpdateStatementParam(stmt.id, "op", e.target.value)
                                }
                                className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                              >
                                <option value="checked_add">Checked Add (+)</option>
                                <option value="checked_sub">Checked Sub (-)</option>
                                <option value="checked_mul">Checked Mul (*)</option>
                                <option value="checked_div">Checked Div (/)</option>
                              </select>
                            </div>
                            {(() => {
                              const values = getNumericExpressions(activeFunction, ast.stateVariables, statementIndex);
                              const leftValue = values.find((value) => value.expression === stmt.params.left) ?? values[0];
                              const compatibleRightValues = values.filter((value) =>
                                canConnectTypes(value.type, [leftValue.type]),
                              );
                              const rightValue = compatibleRightValues.find(
                                (value) => value.expression === stmt.params.right,
                              ) ?? compatibleRightValues[0];
                              return (
                                <>
                                  <div>
                                    <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">
                                      Left Numeric Input ({leftValue.type})
                                    </label>
                                    <select
                                      aria-label={`${stmt.label} left numeric input`}
                                      value={leftValue.expression}
                                      onChange={(event) => {
                                        const nextLeft = values.find((value) => value.expression === event.target.value);
                                        if (!nextLeft) return;
                                        handleUpdateStatementParam(stmt.id, "left", nextLeft.expression);
                                        const currentRight = values.find((value) => value.expression === stmt.params.right);
                                        if (!currentRight || !canConnectTypes(currentRight.type, [nextLeft.type])) {
                                          const nextRight = values.find((value) => canConnectTypes(value.type, [nextLeft.type]));
                                          if (nextRight) handleUpdateStatementParam(stmt.id, "right", nextRight.expression);
                                        }
                                      }}
                                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white"
                                    >
                                      {values.map((value) => (
                                        <option key={value.expression} value={value.expression}>
                                          {value.expression} : {value.type}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">
                                      Right Numeric Input
                                    </label>
                                    <select
                                      aria-label={`${stmt.label} right numeric input`}
                                      value={rightValue.expression}
                                      onChange={(event) =>
                                        handleUpdateStatementParam(stmt.id, "right", event.target.value)
                                      }
                                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white"
                                    >
                                      {compatibleRightValues.map((value) => (
                                        <option key={value.expression} value={value.expression}>
                                          {value.expression} : {value.type}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </>
                              );
                            })()}
                          </>
                        )}

                        {stmt.type === "event_publish" && (
                          <>
                            <div>
                              <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">
                                Event Topic
                              </label>
                              <input
                                type="text"
                                value={stmt.params.topic || ""}
                                onChange={(e) =>
                                  handleUpdateStatementParam(stmt.id, "topic", e.target.value)
                                }
                                className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">
                                Event Payload Data
                              </label>
                              <input
                                type="text"
                                value={stmt.params.data || ""}
                                onChange={(e) =>
                                  handleUpdateStatementParam(stmt.id, "data", e.target.value)
                                }
                                className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-purple-500"
                              />
                            </div>
                          </>
                        )}

                        {stmt.type === "return_statement" && (
                          <div className="col-span-2">
                            <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">
                              Return Value
                            </label>
                            <input
                              type="text"
                              value={stmt.params.value || ""}
                              onChange={(e) =>
                                handleUpdateStatementParam(stmt.id, "value", e.target.value)
                              }
                              className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-slate-500"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Right: Live Synchronized Rust Code (Shown in split and code modes) */}
        {(activeTab === "split" || activeTab === "code") && (
          <div
            className={`flex flex-col bg-[#111622] p-4 overflow-hidden ${
              activeTab === "code" ? "w-full" : "md:w-1/2"
            }`}
            data-testid="generated-rust-code-pane"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <FileCode className="w-4 h-4 text-emerald-400" />
                Live Generated Soroban Rust (lib.rs)
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-700/40">
                Rust Preview
              </span>
            </div>

            <div className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-300 overflow-auto whitespace-pre leading-relaxed select-all">
              {generatedRustCode}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
