import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SecurityAuditBanner from "../../components/SecurityAuditBanner";

describe("SecurityAuditBanner Component", () => {
  const vulnerableContract = `
use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    pub fn withdraw(env: Env, user: Address, amount: i128) {
        let balance: i128 = env.storage().persistent().get(&user).unwrap_or(0);
        env.storage().persistent().set(&user, &(balance - amount));
    }
}
`;

  const secureContract = `
use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    pub fn withdraw(env: Env, user: Address, amount: i128) {
        user.require_auth();
        let balance: i128 = env.storage().persistent().get(&user).unwrap_or(0);
        env.storage().persistent().set(&user, &(balance.checked_sub(amount).unwrap()));
        env.storage().persistent().extend_ttl(&user, 100, 1000);
    }
}
`;

  it("detects vulnerabilities in flawed contract and displays critical grade and score", () => {
    render(<SecurityAuditBanner sourceCode={vulnerableContract} />);

    expect(screen.getByTestId("security-audit-banner")).toBeInTheDocument();

    // Verify grade and score
    const gradeBadge = screen.getByTestId("security-grade-badge");
    expect(gradeBadge).toHaveTextContent(/Grade: F/i);

    const scoreNumber = screen.getByTestId("security-score-number");
    const scoreVal = parseInt(scoreNumber.textContent || "0", 10);
    expect(scoreVal).toBeLessThan(70);

    // Verify critical and medium counts
    expect(screen.getByTestId("count-critical")).toHaveTextContent(/1 Critical/i);
    expect(screen.getByTestId("count-medium")).toHaveTextContent(/1 Medium/i);

    // Verify vulnerability cards are present
    expect(
      screen.getByTestId("vulnerability-card-UnverifiedAddressAuthorization")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("vulnerability-card-MissingTtlRenewal")
    ).toBeInTheDocument();
  });

  it("renders verified 100% clean state for secure contract", () => {
    render(<SecurityAuditBanner sourceCode={secureContract} />);

    expect(screen.getByTestId("security-grade-badge")).toHaveTextContent(/Grade: A\+/i);
    expect(screen.getByTestId("security-score-number")).toHaveTextContent("100");
    expect(screen.getByTestId("audit-clean-state")).toBeInTheDocument();
  });

  it("applies Quick Fix when clicking quick fix button", () => {
    const handleQuickFix = jest.fn();

    render(
      <SecurityAuditBanner
        sourceCode={vulnerableContract}
        onApplyQuickFix={handleQuickFix}
      />
    );

    const quickFixBtn = screen.getByTestId(
      "quick-fix-btn-UnverifiedAddressAuthorization"
    );
    expect(quickFixBtn).toBeInTheDocument();

    fireEvent.click(quickFixBtn);

    expect(handleQuickFix).toHaveBeenCalledTimes(1);
    const patchedCode = handleQuickFix.mock.calls[0][0];
    expect(patchedCode).toContain("user.require_auth();");
  });

  it("applies all safe fixes sequentially via Fix All button", () => {
    const handleQuickFix = jest.fn();

    render(
      <SecurityAuditBanner
        sourceCode={vulnerableContract}
        onApplyQuickFix={handleQuickFix}
      />
    );

    const fixAllBtn = screen.getByTestId("apply-all-fixes-btn");
    expect(fixAllBtn).toBeInTheDocument();

    fireEvent.click(fixAllBtn);

    expect(handleQuickFix).toHaveBeenCalledTimes(1);
    const patchedCode = handleQuickFix.mock.calls[0][0];
    expect(patchedCode).toContain("user.require_auth();");
    expect(patchedCode).toContain("extend_ttl");
  });

  it("allows collapsing and expanding the vulnerability details", () => {
    render(<SecurityAuditBanner sourceCode={vulnerableContract} />);

    const toggleBtn = screen.getByTestId("toggle-audit-details");
    expect(
      screen.getByTestId("vulnerability-card-UnverifiedAddressAuthorization")
    ).toBeInTheDocument();

    // Collapse
    fireEvent.click(toggleBtn);
    expect(
      screen.queryByTestId("vulnerability-card-UnverifiedAddressAuthorization")
    ).not.toBeInTheDocument();

    // Expand
    fireEvent.click(toggleBtn);
    expect(
      screen.getByTestId("vulnerability-card-UnverifiedAddressAuthorization")
    ).toBeInTheDocument();
  });
});
