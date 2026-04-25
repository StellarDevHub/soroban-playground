"use client";

import React, { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  type Edge,
  type Node,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import { GitBranchPlus } from "lucide-react";
import type { TransactionCallGraph } from "@/utils/transactionGraph";

interface TransactionCallGraphProps {
  graph: TransactionCallGraph;
  selectedNodeId?: string;
  onNodeSelect: (nodeId: string) => void;
}

function GraphCanvas({ graph, selectedNodeId, onNodeSelect }: TransactionCallGraphProps) {
  const { fitView } = useReactFlow();

  const nodes = useMemo<Node[]>(() => {
    return graph.nodes.map((node) => ({
      id: node.id,
      position: {
        x: node.depth * 320,
        y: node.indexInDepth * 150,
      },
      data: {
        label: (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-gray-400">{node.contractId}</p>
            <p className="text-sm font-semibold text-gray-100">{node.functionName}</p>
            <p className="text-xs text-cyan-300 break-all">{node.argsSummary}</p>
            {node.resultSummary && <p className="text-xs text-emerald-300 break-all">↳ {node.resultSummary}</p>}
          </div>
        ),
      },
      style: {
        width: 260,
        borderRadius: 10,
        border:
          selectedNodeId === node.id
            ? "1px solid rgba(56,189,248,0.85)"
            : "1px solid rgba(75,85,99,0.7)",
        background: selectedNodeId === node.id ? "#111827" : "#0b1220",
        boxShadow:
          selectedNodeId === node.id
            ? "0 0 0 2px rgba(14,165,233,0.3), 0 8px 30px rgba(2,132,199,0.25)"
            : "0 8px 24px rgba(2, 6, 23, 0.35)",
        color: "#e5e7eb",
        padding: 10,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: false,
    }));
  }, [graph.nodes, selectedNodeId]);

  const edges = useMemo<Edge[]>(() => {
    return graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: "smoothstep",
      animated: true,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#38bdf8",
      },
      style: {
        stroke: "#38bdf8",
        strokeWidth: 1.5,
      },
      labelStyle: {
        fill: "#94a3b8",
        fontSize: 11,
      },
    }));
  }, [graph.edges]);

  useEffect(() => {
    if (nodes.length === 0) {
      return;
    }

    fitView({ padding: 0.2, duration: 300, maxZoom: 1.2 });
  }, [fitView, nodes.length]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      minZoom={0.25}
      maxZoom={1.8}
      onNodeClick={(_, node) => onNodeSelect(node.id)}
      proOptions={{ hideAttribution: true }}
      className="bg-gray-950"
      defaultEdgeOptions={{
        style: { stroke: "#38bdf8" },
      }}
    >
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        className="!bg-gray-900 !border !border-gray-700"
        nodeColor={(node) => (node.id === selectedNodeId ? "#38bdf8" : "#64748b")}
      />
      <Controls className="!bg-gray-900 !border !border-gray-700" />
      <Background gap={18} size={1} color="#1f2937" />
    </ReactFlow>
  );
}

export default function TransactionCallGraph({ graph, selectedNodeId, onNodeSelect }: TransactionCallGraphProps) {
  return (
    <div className="flex flex-col space-y-3 p-5 bg-gray-900 border border-gray-800 rounded-xl shadow-lg mt-4">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center">
        <GitBranchPlus size={16} className="mr-2 text-cyan-400" />
        Transaction Call Graph
      </h3>
      {graph.nodes.length === 0 ? (
        <p className="text-xs text-gray-500 italic">Run a contract call to visualize cross-contract invocation paths.</p>
      ) : (
        <div className="h-[380px] w-full rounded-lg overflow-hidden border border-gray-800">
          <ReactFlowProvider>
            <GraphCanvas graph={graph} selectedNodeId={selectedNodeId} onNodeSelect={onNodeSelect} />
          </ReactFlowProvider>
        </div>
      )}
    </div>
  );
}
