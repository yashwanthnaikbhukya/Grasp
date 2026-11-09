'use client';

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useEffect, useMemo } from 'react';

/**
 * The concept graph, drawn with React Flow.
 *
 * Positions still come from `layoutGraph()` in @grasp/core — deterministic and
 * stable under input order, because spatial memory matters on a map you return
 * to. React Flow adds what the hand-drawn SVG lacked: pan and zoom, fit-to-view
 * (the first column used to be clipped), arrowheads showing prerequisite →
 * dependent, full names instead of truncation, and keyboard focus on nodes.
 */

export type Heat = 'unseen' | 'weak' | 'partial' | 'strong';

export interface GraphNode {
  id: string;
  name: string;
  x: number;
  y: number;
  p: number;
  attempts: number;
  isBlocker: boolean;
  heat: Heat;
}

export interface GraphEdge {
  from: string;
  to: string;
  critical: boolean;
}

interface ConceptData extends Record<string, unknown> {
  label: string;
  heat: Heat;
  isBlocker: boolean;
  inFocus: boolean;
  dim: boolean;
  percent: number | null;
}

const HEAT_WORD: Record<Heat, string> = {
  unseen: 'not started',
  weak: 'weak',
  partial: 'partial',
  strong: 'strong',
};

const ConceptNode = memo(function ConceptNode({ data, selected }: NodeProps<Node<ConceptData>>) {
  return (
    <div
      className={[
        'concept-node',
        `heat-${data.heat}`,
        data.isBlocker ? 'blocker' : '',
        data.inFocus ? 'focus' : '',
        data.dim ? 'dim' : '',
        selected ? 'selected' : '',
      ].join(' ')}
    >
      {/* Edges attach top (prerequisites in) and bottom (dependents out). */}
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="concept-name">{data.label}</span>
      {/* Heat is never colour alone — the state is in text too. */}
      <span className="concept-state">
        {data.percent === null ? HEAT_WORD[data.heat] : `${data.percent}%`}
      </span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});

const nodeTypes = { concept: ConceptNode };

export function ConceptGraph({
  nodes,
  edges,
  focusChain,
  selected,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusChain: string[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  // Selecting a node dims everything not directly connected to it.
  const related = useMemo(() => {
    if (!selected) return null;
    const keep = new Set<string>([selected]);
    for (const e of edges) {
      if (e.to === selected) keep.add(e.from);
      if (e.from === selected) keep.add(e.to);
    }
    return keep;
  }, [selected, edges]);

  const focus = useMemo(() => new Set(focusChain), [focusChain]);

  const rfNodes = useMemo<Node<ConceptData>[]>(
    () =>
      nodes.map((n) => {
        // Display-ready from the loader (conceptLabel).
        const label = n.name;
        const percent = n.attempts > 0 ? Math.round(n.p * 100) : null;
        return {
          id: n.id,
          type: 'concept',
          position: { x: n.x, y: n.y },
          selected: n.id === selected,
          ariaLabel: `${label}: ${percent === null ? 'not started' : `${percent}%, ${HEAT_WORD[n.heat]}`}${n.isBlocker ? ', blocking' : ''}`,
          data: {
            label,
            heat: n.heat,
            isBlocker: n.isBlocker,
            inFocus: focus.has(n.id),
            dim: related ? !related.has(n.id) : false,
            percent,
          },
        };
      }),
    [nodes, selected, focus, related],
  );

  const rfEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => {
        const dim = related ? !(related.has(e.from) && related.has(e.to)) : false;
        const inFocus = focus.has(e.from) && focus.has(e.to);
        const color = e.critical ? 'var(--bad)' : inFocus ? 'var(--cobalt)' : 'var(--rule-strong)';
        return {
          id: `${e.from}->${e.to}`,
          source: e.from,
          target: e.to,
          animated: e.critical,
          focusable: false,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
          style: {
            stroke: color,
            strokeWidth: e.critical || inFocus ? 2 : 1.2,
            opacity: dim ? 0.15 : 1,
          },
        };
      }),
    [edges, focus, related],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      // Layout coordinates are node centres.
      nodeOrigin={[0.5, 0.5]}
      // Fixed, not "system": "system" is resolved in the browser, so the server
      // rendered `light` and the client `dark` — a hydration mismatch. Every
      // colour the map uses is a Grasp token (.map-canvas), so the mode only
      // picks React Flow's unused defaults.
      colorMode="light"
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.3}
      maxZoom={2}
      // Read-only map: positions are the layout's, and nothing is connectable.
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      // One path for mouse and keyboard: a click and Enter on a focused node
      // both arrive as a `select` change. Clicking the background clears it.
      onNodesChange={(changes) => {
        const picked = changes.find((c) => c.type === 'select' && c.selected);
        if (picked && 'id' in picked) onSelect(picked.id);
      }}
      onPaneClick={() => onSelect(null)}
      attributionPosition="bottom-left"
    >
      <Background gap={24} size={1} />
      {/* Top right: the foot of the canvas is where the phone sheet opens. */}
      <Controls showInteractive={false} position="top-right" />
      <FollowSelection selected={selected} nodes={nodes} />
    </ReactFlow>
  );
}

/**
 * Keeps the selected idea in sight. Picking one from the detail panel's
 * "Builds on" / "Leads to" can select a node that is off screen — or, on a
 * phone, under the sheet — so pan just enough to bring it into the visible
 * part of the canvas. A node already in view never moves.
 */
function FollowSelection({ selected, nodes }: { selected: string | null; nodes: GraphNode[] }) {
  const { flowToScreenPosition, setViewport, getViewport } = useReactFlow();
  const dom = useStore((s) => s.domNode);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the selection changes, not when the viewport does.
  useEffect(() => {
    if (!selected || !dom) return;
    const n = nodes.find((x) => x.id === selected);
    if (!n) return;
    // A frame later, so a sheet that just opened has its height.
    const raf = requestAnimationFrame(() => {
      const box = dom.getBoundingClientRect();
      const sheet = dom.closest('.map-body')?.querySelector<HTMLElement>('.map-detail');
      const covers = sheet !== null && sheet !== undefined && getComputedStyle(sheet).position === 'absolute';
      // offsetHeight, not the rect: the sheet is still sliding in.
      const bottom = covers ? box.bottom - sheet.offsetHeight - 8 : box.bottom;
      const p = flowToScreenPosition({ x: n.x, y: n.y });
      const pad = 56;
      const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));
      // The smallest move that brings it into the visible part — never a recentre.
      const dx = clamp(p.x, box.left + pad, box.right - pad) - p.x;
      const dy = clamp(p.y, box.top + pad, bottom - pad) - p.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      const vp = getViewport();
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      void setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }, { duration: still ? 0 : 300 });
    });
    return () => cancelAnimationFrame(raf);
  }, [selected, dom]);

  return null;
}
