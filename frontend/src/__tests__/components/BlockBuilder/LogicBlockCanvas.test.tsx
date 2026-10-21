import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import LogicBlockCanvas, {
  generateSorobanRustCode,
  canConnectTypes,
  TEMPLATE_TOKEN,
  TEMPLATE_ESCROW,
  TEMPLATE_STAKING,
  TEMPLATE_MULTISIG,
  ContractAST,
} from "../../../components/BlockBuilder/LogicBlockCanvas";

describe("LogicBlockCanvas - AST to Rust Code Generator", () => {
  it("generates idiomatic Soroban Rust code for Token Template", () => {
    const code = generateSorobanRustCode(TEMPLATE_TOKEN);

    // Verify Soroban SDK essentials
    expect(code).toContain("#![no_std]");
    expect(code).toContain("use soroban_sdk::{");
    expect(code).toContain("contract, contractimpl, symbol_short, Address, Env, String, Symbol,");
    expect(code).toContain("#[contract]");
    expect(code).toContain("pub struct TokenContract;");
    expect(code).toContain("#[contractimpl]");
    expect(code).toContain("impl TokenContract {");

    // Verify functions and statements
    expect(code).toContain("pub fn initialize(env: Env, admin: Address)");
    expect(code).toContain("admin.require_auth();");
    expect(code).toContain("env.storage().instance().set(&ADMIN, &admin);");
    expect(code).toContain("pub fn mint(env: Env, admin: Address, to: Address, amount: i128) -> i128");
    expect(code).toContain(".checked_add(amount).expect(\"arithmetic overflow\")");
    expect(code).toContain("env.events().publish((symbol_short!(\"MINT\"),), amount);");
    expect(code).toContain("pub fn get_total_supply(env: Env) -> i128");
  });

  it("generates compilable Rust code for Escrow Template", () => {
    const code = generateSorobanRustCode(TEMPLATE_ESCROW);

    expect(code).toContain("pub struct EscrowContract;");
    expect(code).toContain("pub fn deposit(env: Env, depositor: Address, arbiter: Address, beneficiary: Address, amount: i128)");
    expect(code).toContain("depositor.require_auth();");
    expect(code).toContain("pub fn release(env: Env, arbiter: Address) -> bool");
    expect(code).toContain("arbiter.require_auth();");
    expect(code).toContain("env.events().publish((symbol_short!(\"RELEASED\"),), true);");
  });

  it("generates compilable Rust code for Staking Template", () => {
    const code = generateSorobanRustCode(TEMPLATE_STAKING);

    expect(code).toContain("pub struct StakingContract;");
    expect(code).toContain("pub fn stake(env: Env, user: Address, amount: i128) -> i128");
    expect(code).toContain("user.require_auth();");
    expect(code).toContain("env.storage().instance().get(&TOTAL_STAKED)");
    expect(code).toContain(".checked_add(amount)");
  });

  it("generates compilable Rust code for Multisig Template", () => {
    const code = generateSorobanRustCode(TEMPLATE_MULTISIG);

    expect(code).toContain("pub struct MultisigContract;");
    expect(code).toContain("pub fn execute_proposal(env: Env, signer_a: Address, signer_b: Address) -> bool");
    expect(code).toContain("signer_a.require_auth();");
    expect(code).toContain("signer_b.require_auth();");
  });

  it("handles custom AST with no functions gracefully", () => {
    const emptyAST: ContractAST = {
      contractName: "EmptyContract",
      stateVariables: [],
      functions: [],
    };
    const code = generateSorobanRustCode(emptyAST);
    expect(code).toContain("pub struct EmptyContract;");
    expect(code).toContain("impl EmptyContract {");
  });

  it("widens a selected u32 operand for an i128 checked operation", () => {
    const ast: ContractAST = {
      contractName: "TypedContract",
      stateVariables: [],
      functions: [{
        id: "fn-typed",
        name: "add",
        isView: true,
        parameters: [{ name: "amount", type: "i128" }, { name: "count", type: "u32" }],
        returnType: "i128",
        statements: [{
          id: "stmt-add",
          type: "math_op",
          label: "Add values",
          params: { resultVar: "total", left: "amount", op: "checked_add", right: "count" },
        }, {
          id: "stmt-return",
          type: "return_statement",
          label: "Return total",
          params: { value: "total" },
        }],
      }],
    };

    expect(generateSorobanRustCode(ast)).toContain("amount.checked_add(i128::from(count))");
  });
});

describe("LogicBlockCanvas - Type Safety Grammar", () => {
  it("allows identical types to connect", () => {
    expect(canConnectTypes("Address", ["Address"])).toBe(true);
    expect(canConnectTypes("i128", ["i128"])).toBe(true);
    expect(canConnectTypes("Symbol", ["Symbol"])).toBe(true);
  });

  it("permits numeric coercion from u32 to i128 slot", () => {
    expect(canConnectTypes("u32", ["i128"])).toBe(true);
    expect(canConnectTypes("u64", ["i128"])).toBe(true);
  });

  it("rejects incompatible types (Address to numeric or bool)", () => {
    expect(canConnectTypes("Address", ["i128"])).toBe(false);
    expect(canConnectTypes("Address", ["u32"])).toBe(false);
    expect(canConnectTypes("bool", ["Address"])).toBe(false);
    expect(canConnectTypes("String", ["i128"])).toBe(false);
  });
});

describe("LogicBlockCanvas UI Component", () => {
  it("renders header, template buttons, and split view by default", () => {
    render(<LogicBlockCanvas />);

    expect(screen.getByText(/Soroban Logic Block Builder/i)).toBeInTheDocument();
    expect(screen.getByTestId("template-btn-token")).toBeInTheDocument();
    expect(screen.getByTestId("template-btn-escrow")).toBeInTheDocument();
    expect(screen.getByTestId("template-btn-staking")).toBeInTheDocument();
    expect(screen.getByTestId("template-btn-multisig")).toBeInTheDocument();
    expect(screen.getByTestId("generated-rust-code-pane")).toBeInTheDocument();
  });

  it("switches templates and updates AST when clicking template buttons", () => {
    render(<LogicBlockCanvas />);

    const escrowBtn = screen.getByTestId("template-btn-escrow");
    fireEvent.click(escrowBtn);

    expect(screen.getByText(/Contract:/i)).toHaveTextContent("EscrowContract");
    expect(screen.getByText(/fn deposit\(\)/i)).toBeInTheDocument();
    expect(screen.getByText(/fn release\(\)/i)).toBeInTheDocument();
  });

  it("adds new statement blocks to the active function", () => {
    render(<LogicBlockCanvas />);

    const addAuthBtn = screen.getByTestId("add-block-auth");
    fireEvent.click(addAuthBtn);

    const authBlocks = screen.getAllByTestId("statement-block-auth_check");
    expect(authBlocks.length).toBeGreaterThan(0);
  });

  it("offers only numeric values in math operand sockets", () => {
    const ast: ContractAST = {
      contractName: "TypedContract",
      stateVariables: [],
      functions: [{
        id: "fn-typed",
        name: "calculate",
        isView: true,
        parameters: [{ name: "owner", type: "Address" }, { name: "amount", type: "i128" }],
        returnType: "i128",
        statements: [],
      }],
    };
    render(<LogicBlockCanvas initialAST={ast} />);
    fireEvent.click(screen.getByTestId("add-block-math"));

    expect(screen.getAllByRole("option", { name: "amount : i128" })).toHaveLength(2);
    expect(screen.queryByRole("option", { name: "owner : Address" })).not.toBeInTheDocument();
  });

  it("adds a palette block when it is dragged onto the canvas", () => {
    render(<LogicBlockCanvas />);
    const paletteBlock = screen.getByTestId("add-block-event");
    const dropTarget = screen.getByTestId("block-drop-target");
    const dataTransfer = {
      setData: jest.fn(),
      getData: jest.fn(() => "event_publish"),
      effectAllowed: "",
    };

    fireEvent.dragStart(paletteBlock, { dataTransfer });
    fireEvent.drop(dropTarget, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith("application/x-soroban-block", "event_publish");
    expect(dataTransfer.getData).toHaveBeenCalledWith("application/x-soroban-block");
    expect(screen.getAllByTestId("statement-block-event_publish")).toHaveLength(1);
  });

  it("switches view modes between canvas, split, and code", () => {
    render(<LogicBlockCanvas />);

    // Switch to code only
    const codeTabBtn = screen.getByRole("button", { name: "Rust Code", exact: true });
    fireEvent.click(codeTabBtn);
    expect(screen.queryByText(/Snap In Logic Blocks:/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("generated-rust-code-pane")).toBeInTheDocument();

    // Switch to blocks only
    const blocksTabBtn = screen.getByRole("button", { name: /Blocks Only/i });
    fireEvent.click(blocksTabBtn);
    expect(screen.getByText(/Snap In Logic Blocks:/i)).toBeInTheDocument();
    expect(screen.queryByTestId("generated-rust-code-pane")).not.toBeInTheDocument();
  });

  it("invokes onChangeCode when blocks change", () => {
    const handleChangeCode = jest.fn();
    render(<LogicBlockCanvas onChangeCode={handleChangeCode} />);

    expect(handleChangeCode).toHaveBeenCalledWith(expect.stringContaining("pub struct TokenContract;"));

    // Add a block to trigger update
    const addMathBtn = screen.getByTestId("add-block-math");
    fireEvent.click(addMathBtn);

    expect(handleChangeCode).toHaveBeenCalledWith(expect.stringContaining("checked_add"));
  });

  it("invokes onSendToEditor when button is clicked", () => {
    const handleSendToEditor = jest.fn();
    render(<LogicBlockCanvas onSendToEditor={handleSendToEditor} />);

    const sendBtn = screen.getByTestId("send-to-editor-btn");
    fireEvent.click(sendBtn);

    expect(handleSendToEditor).toHaveBeenCalledWith(expect.stringContaining("pub struct TokenContract;"));
  });

  it("copies generated code to clipboard", async () => {
    const writeTextMock = jest.fn();
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(<LogicBlockCanvas />);

    const copyBtn = screen.getByRole("button", { name: /Copy generated Rust code/i });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining("pub struct TokenContract;"));
    expect(await screen.findByText(/Copied/i)).toBeInTheDocument();
  });
});
