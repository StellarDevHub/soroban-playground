// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import FeeBumpToggle from "../../components/transaction/FeeBumpToggle";

describe("FeeBumpToggle", () => {
  const mockSponsorAddress = "GC3XPWNDCVYHFGKN3LQF3AHOQNTH52Q2Z2VSHJIIPSPSRGYEFESGBFOK";
  const defaultBreakdown = {
    isSponsored: true,
    sponsorAddress: mockSponsorAddress,
    maxFeeStroops: "400",
    maxFeeXlm: "0.0000400 XLM",
    studentFeeStroops: "0",
    studentFeeXlm: "0.0000000 XLM",
    innerFeeStroops: "100",
    innerFeeXlm: "0.0000100 XLM",
  };

  it("renders sponsorship toggle switch with proper initial state", () => {
    const onChange = jest.fn();
    render(
      <FeeBumpToggle
        enabled={true}
        onChange={onChange}
        feeBreakdown={defaultBreakdown}
      />
    );

    const toggle = screen.getByRole("switch", { name: /toggle transaction sponsorship/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Lab Sponsored")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("displays fee breakdown showing sponsor address and max fee limits when enabled", () => {
    render(
      <FeeBumpToggle
        enabled={true}
        onChange={jest.fn()}
        feeBreakdown={defaultBreakdown}
      />
    );

    const breakdown = screen.getByTestId("fee-breakdown");
    expect(breakdown).toBeInTheDocument();

    // Verify sponsor address
    const sponsorEl = screen.getByTestId("sponsor-address");
    expect(sponsorEl).toBeInTheDocument();
    expect(sponsorEl).toHaveAttribute("title", mockSponsorAddress);

    // Verify max fee limit
    const maxFeeEl = screen.getByTestId("max-fee-limit");
    expect(maxFeeEl).toHaveTextContent("400 stroops");
    expect(maxFeeEl).toHaveTextContent("0.0000400 XLM");

    // Verify student fee is 0 XLM (Free)
    const studentFeeEl = screen.getByTestId("student-fee");
    expect(studentFeeEl).toHaveTextContent("0 stroops");
    expect(studentFeeEl).toHaveTextContent("Free");

    // Verify inner base fee
    const innerFeeEl = screen.getByTestId("inner-fee");
    expect(innerFeeEl).toHaveTextContent("100 stroops");
  });

  it("displays self-pay breakdown when sponsorship is disabled", () => {
    const selfPayBreakdown = {
      isSponsored: false,
      innerFeeStroops: "100",
      innerFeeXlm: "0.0000100 XLM",
      studentFeeStroops: "100",
      studentFeeXlm: "0.0000100 XLM",
    };

    render(
      <FeeBumpToggle
        enabled={false}
        onChange={jest.fn()}
        feeBreakdown={selfPayBreakdown}
      />
    );

    expect(screen.getByText("Self-Pay")).toBeInTheDocument();
    expect(screen.queryByTestId("sponsor-address")).not.toBeInTheDocument();
    expect(screen.queryByTestId("max-fee-limit")).not.toBeInTheDocument();

    const studentFeeEl = screen.getByTestId("student-fee");
    expect(studentFeeEl).toHaveTextContent("100 stroops");
    expect(screen.queryByText("Free")).not.toBeInTheDocument();
  });

  it("displays fallback alert when relayer sponsor budget is exhausted", () => {
    render(
      <FeeBumpToggle
        enabled={false}
        onChange={jest.fn()}
        isBudgetExhausted={true}
        fallbackMessage="Relayer sponsor budget is exhausted. Falling back to self-pay."
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/relayer sponsor budget exhausted/i);
    expect(alert).toHaveTextContent(/falling back to self-pay/i);

    const toggle = screen.getByRole("switch");
    expect(toggle).toBeDisabled();
  });

  it("allows copying sponsor address to clipboard", () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockImplementation(() => Promise.resolve()),
      },
    });

    render(
      <FeeBumpToggle
        enabled={true}
        onChange={jest.fn()}
        feeBreakdown={defaultBreakdown}
      />
    );

    const copyBtn = screen.getByTitle(/copy sponsor public key/i);
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockSponsorAddress);
  });
});
