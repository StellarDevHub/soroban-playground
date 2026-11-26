import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TemplateForkModal from "../../components/TemplateForkModal";
import type { Template } from "../../lib/templates";
import * as templateService from "../../services/templateService";

describe("TemplateForkModal Component", () => {
  const mockTemplate: Template = {
    id: "defi-amm",
    name: "Constant-Product AMM Liquidity Pool",
    description: "Automated market maker with x * y = k liquidity pools.",
    category: "DeFi",
    tags: ["defi", "amm", "swap"],
    difficulty: "Advanced",
    communityRating: 4.9,
    ratingCount: 382,
    forksCount: 890,
    code: `#![no_std]\nuse soroban_sdk::{contract, contractimpl};\n#[contract]\npub struct AmmContract;\n`,
  };

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    render(
      <TemplateForkModal
        template={mockTemplate}
        isOpen={false}
        onClose={jest.fn()}
      />
    );
    expect(screen.queryByTestId("template-fork-modal")).not.toBeInTheDocument();
  });

  it("renders modal with workspace overwrite warning and template details", () => {
    render(
      <TemplateForkModal
        template={mockTemplate}
        isOpen={true}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("Fork Template: Constant-Product AMM Liquidity Pool")
    ).toBeInTheDocument();

    // Verify warning alert is present
    expect(screen.getByTestId("workspace-warning-alert")).toBeInTheDocument();
    expect(
      screen.getByText("Workspace Replacement Notice")
    ).toBeInTheDocument();

    // Verify template difficulty and rating are shown
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    expect(screen.getByText(/4\.9/)).toBeInTheDocument();
  });

  it("safely forks into a new isolated project namespace without modifying active workspace", () => {
    const handleForkComplete = jest.fn();
    const forkSpy = jest.spyOn(templateService, "forkTemplate");

    render(
      <TemplateForkModal
        template={mockTemplate}
        isOpen={true}
        onClose={jest.fn()}
        onForkComplete={handleForkComplete}
      />
    );

    // Verify "Fork into New Project Namespace" is selected by default
    expect(screen.getByTestId("option-new-project")).toBeInTheDocument();
    const nameInput = screen.getByTestId("project-name-input");
    expect(nameInput).toHaveValue("defi-amm-sandbox");

    // Modify project name
    fireEvent.change(nameInput, { target: { value: "my-amm-experiment" } });

    // Confirm fork
    fireEvent.click(screen.getByTestId("confirm-fork-button"));

    expect(forkSpy).toHaveBeenCalledWith({
      template: {
        id: "defi-amm",
        name: "Constant-Product AMM Liquidity Pool",
        code: mockTemplate.code,
      },
      target: "new_project",
      newProjectName: "my-amm-experiment",
      autoBackup: true,
    });

    expect(handleForkComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        namespace: "my-amm-experiment",
        backupCreated: false,
      })
    );
  });

  it("triggers automatic safety backup when choosing to replace active workspace code", () => {
    const handleForkComplete = jest.fn();
    const forkSpy = jest.spyOn(templateService, "forkTemplate");

    render(
      <TemplateForkModal
        template={mockTemplate}
        isOpen={true}
        onClose={jest.fn()}
        onForkComplete={handleForkComplete}
      />
    );

    // Select "Replace Current Workspace Code"
    fireEvent.click(screen.getByTestId("option-replace-current"));

    // Verify auto-backup checkbox is present and checked
    const backupCheckbox = screen.getByTestId("auto-backup-checkbox");
    expect(backupCheckbox).toBeChecked();

    // Confirm fork
    fireEvent.click(screen.getByTestId("confirm-fork-button"));

    expect(forkSpy).toHaveBeenCalledWith({
      template: {
        id: "defi-amm",
        name: "Constant-Product AMM Liquidity Pool",
        code: mockTemplate.code,
      },
      target: "replace_current",
      newProjectName: "defi-amm-sandbox",
      autoBackup: true,
    });

    expect(handleForkComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        backupCreated: true,
      })
    );
  });

  it("closes modal on Escape key press or close button click", () => {
    const handleClose = jest.fn();

    render(
      <TemplateForkModal
        template={mockTemplate}
        isOpen={true}
        onClose={handleClose}
      />
    );

    // Press Escape
    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Click close button
    fireEvent.click(screen.getByTestId("close-fork-modal"));
    expect(handleClose).toHaveBeenCalledTimes(2);
  });
});
