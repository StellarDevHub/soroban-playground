import { MarkerType } from "reactflow";

export function createNodeStyle(isSelected: boolean) {
  return {
    width: 260,
    borderRadius: 10,
    border: isSelected
      ? "1px solid rgba(56,189,248,0.85)"
      : "1px solid rgba(75,85,99,0.7)",
    background: isSelected ? "#111827" : "#0b1220",
    boxShadow: isSelected
      ? "0 0 0 2px rgba(14,165,233,0.3), 0 8px 30px rgba(2,132,199,0.25)"
      : "0 8px 24px rgba(2, 6, 23, 0.35)",
    color: "#e5e7eb",
    padding: 10,
  };
}

export function createEdgeStyle(
  color = "#38bdf8",
  strokeWidth = 1.5,
) {
  return {
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color,
    },
    style: {
      stroke: color,
      strokeWidth,
    },
    labelStyle: {
      fill: color,
      fontSize: 11,
    },
  };
}
