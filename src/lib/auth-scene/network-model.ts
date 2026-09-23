// ============================================================
// Dialo AI — Communication Network: Geometry
// ============================================================
//
// The shape of the background scene, kept apart from how it animates.
//
// The composition is deliberately hand-placed rather than generated. Random
// points produce the "floating particles" look the brief rules out; a routed
// network reads as infrastructure because the paths go somewhere. Every node
// sits outside a central exclusion zone, so nothing ever competes with the
// panel or drifts underneath the form fields.
//
// Coordinates are in a fixed 1000×640 viewBox. SVG scales that to any screen,
// which is why there is no responsive maths here — only density, which the
// component chooses by dropping the nodes marked `tier: "far"` on smaller
// screens.
// ============================================================

export interface NetworkNode {
  id: string;
  x: number;
  y: number;
  /**
   * How prominent the node is. `near` nodes anchor the composition and always
   * render; `far` nodes add depth and are dropped on small screens, and they
   * parallax more, which is what produces the sense of distance.
   */
  tier: "near" | "far";
  /** Radius in viewBox units. */
  r: number;
}

export interface NetworkEdge {
  id: string;
  from: string;
  to: string;
  /**
   * How far the path bows away from the straight line between its endpoints.
   * Signed, so adjacent edges can curve opposite ways and the network does not
   * look like a bundle of parallel arcs.
   */
  curve: number;
  /** Edges on a trunk route carry more signals and sit slightly brighter. */
  trunk?: boolean;
}

export const VIEWBOX = { width: 1000, height: 640 } as const;

/**
 * The area the panel occupies, in viewBox units.
 *
 * Nothing is placed inside it. Checked by a test rather than by eye, because
 * "the waveform is behind the password field" is the kind of regression that
 * only shows up on one screen size.
 */
export const PANEL_EXCLUSION = {
  x: 300,
  y: 140,
  width: 400,
  height: 360,
} as const;

export const NODES: NetworkNode[] = [
  // Left cluster — the origin side of the routes.
  { id: "a1", x: 88, y: 128, tier: "near", r: 4.5 },
  { id: "a2", x: 172, y: 296, tier: "near", r: 6 },
  { id: "a3", x: 96, y: 468, tier: "near", r: 4.5 },
  { id: "a4", x: 232, y: 556, tier: "far", r: 3 },
  { id: "a5", x: 44, y: 316, tier: "far", r: 3 },

  // Upper and lower bridges. These carry the trunk routes over and under the
  // panel, so they stay in the `near` tier — dropping them on a small screen
  // would leave the network with no route running through it.
  { id: "b1", x: 396, y: 72, tier: "near", r: 4 },
  { id: "b2", x: 612, y: 60, tier: "near", r: 5 },
  { id: "b3", x: 404, y: 592, tier: "near", r: 5 },
  { id: "b4", x: 640, y: 604, tier: "near", r: 4 },

  // Right cluster — the destination side.
  { id: "c1", x: 836, y: 148, tier: "near", r: 6 },
  { id: "c2", x: 940, y: 300, tier: "near", r: 4.5 },
  { id: "c3", x: 828, y: 472, tier: "near", r: 5.5 },
  { id: "c4", x: 962, y: 548, tier: "far", r: 3 },
  { id: "c5", x: 908, y: 92, tier: "far", r: 3 },
];

export const EDGES: NetworkEdge[] = [
  // Left cluster, internal.
  { id: "e1", from: "a1", to: "a2", curve: 26 },
  { id: "e2", from: "a2", to: "a3", curve: -22 },
  { id: "e3", from: "a5", to: "a2", curve: 14 },
  { id: "e4", from: "a3", to: "a4", curve: 18 },

  // The trunk routes: left to right, arcing clear of the panel.
  { id: "t1", from: "a1", to: "b1", curve: -30, trunk: true },
  { id: "t2", from: "b1", to: "b2", curve: -34, trunk: true },
  { id: "t3", from: "b2", to: "c1", curve: -28, trunk: true },
  { id: "t4", from: "a3", to: "b3", curve: 30, trunk: true },
  { id: "t5", from: "b3", to: "b4", curve: 26, trunk: true },
  { id: "t6", from: "b4", to: "c3", curve: 30, trunk: true },

  // Right cluster, internal.
  { id: "e5", from: "c1", to: "c2", curve: 24 },
  { id: "e6", from: "c2", to: "c3", curve: 20 },
  { id: "e7", from: "c5", to: "c1", curve: -12 },
  { id: "e8", from: "c3", to: "c4", curve: -16 },

  // Long outer links, which give the network its sense of extent.
  // Bows away from the centre, not across it: the panel sits in the middle
  // of the straight line between these two.
  { id: "e9", from: "a2", to: "b1", curve: -40 },
  { id: "e10", from: "c2", to: "b2", curve: 44 },
];

const nodeById = new Map(NODES.map((node) => [node.id, node]));

export function getNode(id: string): NetworkNode {
  const node = nodeById.get(id);
  if (!node) throw new Error(`Unknown network node: ${id}`);
  return node;
}

/**
 * A quadratic curve between two nodes.
 *
 * The control point is offset perpendicular to the line, so `curve` bends the
 * path consistently whatever direction the edge runs in.
 */
export function edgePath(edge: NetworkEdge): string {
  const from = getNode(edge.from);
  const to = getNode(edge.to);

  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;

  // Unit normal to the segment.
  const nx = -dy / length;
  const ny = dx / length;

  const cx = midX + nx * edge.curve;
  const cy = midY + ny * edge.curve;

  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}

/** True when a point sits inside the area reserved for the panel. */
export function insidePanelZone(x: number, y: number, padding = 0): boolean {
  return (
    x >= PANEL_EXCLUSION.x - padding &&
    x <= PANEL_EXCLUSION.x + PANEL_EXCLUSION.width + padding &&
    y >= PANEL_EXCLUSION.y - padding &&
    y <= PANEL_EXCLUSION.y + PANEL_EXCLUSION.height + padding
  );
}

/** The edges a signal can travel down, in the order a route would use them. */
export const TRUNK_ROUTES: string[][] = [
  ["t1", "t2", "t3"],
  ["t4", "t5", "t6"],
];

/**
 * The few paths the scene narrows to while a password is being entered.
 *
 * A short, closed route rather than the open trunk: the point is that the
 * network visibly stops broadcasting and holds a single circuit.
 */
export const SECURE_EDGES = ["e5", "e6", "e2"];

/** Nodes that light up when the email field is focused, in activation order. */
export const INTAKE_NODES = ["a2", "a1", "b1"];
