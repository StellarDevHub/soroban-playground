import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import StateMachineModeler from "@/components/Visualizer/StateMachineModeler";
import { extractStateMachine, toPlantUml, toXStateMachine } from "@/utils/stateMachine";

const source = `
  pub enum Lifecycle { Uninitialized, Active, Paused, Liquidated }
  #[contractimpl]
  impl Contract {
    pub fn initialize(e: Env) { self.state = Lifecycle::Active; }
    pub fn pause(e: Env) { self.state = Lifecycle::Paused; }
    pub fn liquidate(e: Env) { self.state = Lifecycle::Liquidated; }
  }
`;

describe("state machine extraction", () => {
  it("extracts lifecycle variants and method transitions", () => {
    const model = extractStateMachine(source, [
      { name: "initialize", inputs: [{ name: "e", type: "Env" }] },
    ]);
    expect(model.enumName).toBe("Lifecycle");
    expect(model.initialState).toBe("Uninitialized");
    expect(model.states.map((state) => state.id)).toEqual([
      "Uninitialized",
      "Active",
      "Paused",
      "Liquidated",
    ]);
    expect(model.transitions.map((transition) => [transition.functionName, transition.target])).toEqual([
      ["initialize", "Active"],
      ["pause", "Paused"],
      ["liquidate", "Liquidated"],
    ]);
  });

  it("exports XState v5-compatible targets and final states", () => {
    const definition = toXStateMachine(extractStateMachine(source));
    expect(definition.initial).toBe("Uninitialized");
    expect(definition.states.Liquidated.type).toBe("final");
    expect(definition.states.Uninitialized.on?.INITIALIZE.target).toBe("#sorobanLifecycle.Active");
  });

  it("exports a PlantUML state diagram", () => {
    const plantUml = toPlantUml(extractStateMachine(source));
    expect(plantUml).toContain("@startuml");
    expect(plantUml).toContain("[*] --> Liquidated : liquidate");
    expect(plantUml).toContain("@enduml");
  });
});

describe("StateMachineModeler", () => {
  it("highlights the live state and exposes clickable transition edges", () => {
    const onSelected = jest.fn();
    render(
      <StateMachineModeler
        sourceCode={source}
        currentState="Paused"
        onTransitionSelected={onSelected}
      />,
    );
    expect(screen.getByText("Live ledger state: Paused")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select transition liquidate" }));
    expect(onSelected).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "liquidate", target: "Liquidated" }),
      {},
    );
  });
});
