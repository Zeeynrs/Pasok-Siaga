"use client";

import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import { Boxes, Package, Truck } from "lucide-react";
import type { NetworkEdge, NetworkKind, NetworkNode } from "@/lib/types";
import { edgeLabel, kindLabel, statusLabel } from "./network-labels";
import "@xyflow/react/dist/style.css";

const kinds: NetworkKind[] = ["supplier", "material", "product"];
const icons = { supplier: Truck, material: Boxes, product: Package };
const line = { committed: "#397766", alternative: "#ab6b2b", bom: "#88958d" };

type FlowNode = Node<{ item: NetworkNode }, "supply">;

function SupplyNode({ data: { item }, selected }: NodeProps<FlowNode>) {
  const Icon = icons[item.kind];
  const status = statusLabel[item.status];
  const isBottleneck = item.kind === "material" && item.overlay?.tone === "bad";
  return (
    <div
      className={`flow-node flow-${item.kind}${selected ? " flow-selected" : ""}${isBottleneck ? " flow-bottleneck" : ""}`}
      title={item.detail}
    >
      {item.kind !== "supplier" && <Handle className="flow-handle" type="target" position={Position.Left} isConnectable={false} />}
      <Icon size={18} className="flow-icon" aria-hidden="true" />
      <div className="flow-node-body">
        <strong>{item.label}</strong>
        <small className={`flow-status ${status?.tone ?? ""}`}>{status?.label ?? item.status}</small>
        {item.overlay && (
          <span className={`flow-overlay-pill tag tag-${item.overlay.tone}`}>
            <span>{item.overlay.badge}</span>
            <span>{item.overlay.metric}</span>
          </span>
        )}
      </div>
      {item.kind !== "product" && <Handle className="flow-handle" type="source" position={Position.Right} isConnectable={false} />}
    </div>
  );
}

const nodeTypes = { supply: SupplyNode };
const fitViewOptions = { padding: 0.18, maxZoom: 1.1 };
const graphLabels = {
  "node.a11yDescription.default": "Tekan Enter untuk memilih titik jaringan. Tekan Escape untuk membatalkan pilihan.",
  "controls.zoomIn.ariaLabel": "Perbesar graf",
  "controls.zoomOut.ariaLabel": "Perkecil graf",
  "controls.fitView.ariaLabel": "Lihat seluruh graf",
};

export function NetworkCanvas({ nodes, edges, selected, onSelect }: {
  nodes: NetworkNode[]; edges: NetworkEdge[]; selected: string | undefined; onSelect: (id: string | undefined) => void;
}) {
  const groups = kinds.map((kind) => nodes.filter((node) => node.kind === kind));
  const maxRows = Math.max(...groups.map((group) => group.length));
  const flowNodes = groups.flatMap((group, column) => group.map((item, row): FlowNode => ({
    id: item.id,
    type: "supply",
    data: { item },
    ariaLabel: `${item.label}, ${kindLabel[item.kind].toLowerCase()}${item.overlay ? `, ${item.overlay.badge}, ${item.overlay.metric}` : ""}`,
    position: { x: column * 254, y: row * 105 + ((maxRows - group.length) * 105) / 2 },
    selected: selected === item.id,
  })));
  const flowEdges = edges.map((item): Edge => {
    const stroke = item.active ? line[item.kind] : "#adb8b0";
    return {
      id: item.id, source: item.source, target: item.target, type: "smoothstep", selectable: false,
      label: item.used ? item.overlayLabel : undefined,
      ariaLabel: `${edgeLabel[item.kind]}${item.active ? "" : ", tidak aktif"}${item.used && item.overlayLabel ? `, dipakai ${item.overlayLabel}` : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      style: {
        stroke,
        strokeWidth: item.used ? 2.6 : 1.6,
        strokeDasharray: item.used ? undefined : item.kind === "alternative" || !item.active ? "5 5" : undefined,
      },
    };
  });

  function changeSelection(changes: NodeChange<FlowNode>[]) {
    const next = changes.find((change) => change.type === "select" && change.selected);
    if (next?.type === "select") onSelect(next.id);
    else if (changes.some((change) => change.type === "select" && change.id === selected)) onSelect(undefined);
  }

  return (
    <div className="network-canvas" aria-label="Graf jaringan pasok">
      <ReactFlow
        nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} fitView fitViewOptions={fitViewOptions}
        minZoom={0.2} maxZoom={1.8} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false}
        deleteKeyCode={null} ariaLabelConfig={graphLabels} onNodesChange={changeSelection}
      >
        <Background gap={20} size={1} color="#c9d7cb" />
        <Controls showInteractive={false} position="bottom-right" aria-label="Kontrol graf" />
      </ReactFlow>
    </div>
  );
}
