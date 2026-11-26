"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type { TransactionCallGraph } from "@/utils/transactionGraph";
import {
  createNodeStyle,
  createEdgeStyle,
} from "@/utils/transactionGraphStyles";
import {
  buildGasHotspotLevels,
  computeDagreLikeLayout,
  isLayoutResponse,
  type GraphPositions,
  type LayoutRequest,
  type LayoutResponse,
} from "@/utils/transactionGraphLayout";

interface ContractCallNodeData extends Record<string, unknown> {
  contractId: string;
  functionName: string;
  argsSummary: string;
  resultSummary?: string;
}

type ContractCallFlowNode = Node<ContractCallNodeData, "contractCall">;

const ContractCallNode = React.memo(function ContractCallNode({
  data,
}: NodeProps<ContractCallNodeData>) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-gray-400">
        {data.contractId}
      </p>
      <p className="text-sm font-semibold text-gray-100">{data.functionName}</p>
      <p className="text-xs text-cyan-300 break-all">{data.argsSummary}</p>
      {data.resultSummary && (
        <p className="text-xs text-emerald-300 break-all">
          ↳ {data.resultSummary}
        </p>
      )}
    </div>
  );
});

const NODE_TYPES = { contractCall: ContractCallNode };

const GAS_COLORS = ["#38bdf8", "#f59e0b", "#f43f5e"] as const;
const GAS_WIDTHS = [1.5, 2, 3] as const;

interface TransactionCallGraphCanvasProps {
  graph: TransactionCallGraph;
  selectedNodeId?: string;
  onNodeSelect: (nodeId: string) => void;
}

export default function TransactionCallGraphCanvas({
  graph,
  selectedNodeId,
  onNodeSelect,
}: TransactionCallGraphCanvasProps) {
  const { fitView } = useReactFlow();
  const [positions, setPositions] = useState<GraphPositions>({});
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    const request: LayoutRequest = {
      requestId,
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        depth: node.depth,
        parentId: node.parentId,
      })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      })),
    };

    if (typeof window === "undefined" || typeof Worker === "undefined") {
      setPositions(computeDagreLikeLayout(request.nodes, request.edges));
      return;
    }

    if (!workerRef.current) {
      const worker = new Worker(
        new URL("../workers/transactionGraphLayout.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (event: MessageEvent<LayoutResponse>) => {
        if (isLayoutResponse(event.data) && event.data.requestId === requestRef.current) {
          setPositions(event.data.positions);
        }
      };
      workerRef.current = worker;
    }

    workerRef.current.postMessage(request);
  }, [graph.nodes, graph.edges]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const gasLevels = useMemo(
    () =>
      buildGasHotspotLevels(
        graph.nodes.map((node) => ({ id: node.id, raw: node.raw })),
        graph.edges,
      ),
    [graph.nodes, graph.edges],
  );

  const nodes = useMemo<ContractCallFlowNode[]>(() => {
    return graph.nodes.map((node) => {
      const position = positions[node.id] ?? {
        x: node.depth * 320,
        y: node.indexInDepth * 150,
      };

      return {
        id: node.id,
        type: "contractCall",
        position,
        data: {
          contractId: node.contractId,
          functionName: node.functionName,
          argsSummary: node.argsSummary,
          resultSummary: node.resultSummary,
        },
        style: createNodeStyle(selectedNodeId === node.id),
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: false,
      };
    });
  }, [graph.nodes, positions, selectedNodeId]);

  const edges = useMemo<Edge[]>(() => {
    return graph.edges.map((edge) => {
      const level = gasLevels[edge.id] ?? 0;
      const color = GAS_COLORS[level];
      const style = createEdgeStyle(color, GAS_WIDTHS[level]);

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: "smoothstep",
        animated: level > 0,
        ...style,
      };
    });
  }, [graph.edges, gasLevels]);

  useEffect(() => {
    if (nodes.length === 0) {
      return;
    }

    fitView({ padding: 0.2, duration: 300, maxZoom: 1.2 });
  }, [fitView, nodes.length, positions]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      fitView
      minZoom={0.25}
      maxZoom={1.8}
      onlyRenderVisibleElements
      nodesConnectable={false}
      onNodeClick={(_, node) => onNodeSelect(node.id)}
      proOptions={{ hideAttribution: true }}
      className="bg-gray-950"
      defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
    >
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        className="!bg-gray-900 !border !border-gray-700"
        nodeColor={(node) =>
          node.id === selectedNodeId ? "#38bdf8" : "#64748b"
        }
      />
      <Controls className="!bg-gray-900 !border !border-gray-700" />
      <Background gap={18} size={1} color="#1f2937" />
    </ReactFlow>
  );
}
