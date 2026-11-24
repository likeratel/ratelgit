/**
 * Lane layout for a topologically ordered commit list that may start from many ref heads.
 * Ported from the SwiftUI version's `CommitGraph`. A parent that has not been loaded yet keeps
 * its lane open, so lines run off the bottom of the last row and continue when the next page
 * arrives. The main line keeps its colour; merged branches join it.
 */

export interface GraphCommit {
  hash: string;
  parents: string[];
}

export interface GraphEdge {
  from: number;
  to: number;
  color: number;
}

export interface GraphRow {
  lane: number;
  color: number;
  /** Line coming down into the node from the row above. */
  incoming: GraphEdge[];
  /** Lines leaving the row: pass-through lanes start at the top, parent edges at the node. */
  outgoing: GraphEdge[];
}

export interface GraphLayout {
  rows: GraphRow[];
  columns: number;
}

interface Lane {
  target: string;
  color: number;
}

interface LayoutState {
  lanes: Lane[];
  rows: GraphRow[];
  width: number;
  nextColor: number;
}

const findLane = (lanes: Lane[], target: string) =>
  lanes.findIndex((lane) => lane.target === target);

/** Lanes after the commit at `index` is replaced by its parents. */
function placeParents(
  lanes: Lane[],
  commit: GraphCommit,
  index: number,
  color: number,
  firstFreeColor: number,
): { lanes: Lane[]; nextColor: number } {
  const [first] = commit.parents;
  const shared = first === undefined ? -1 : findLane(lanes, first);
  // A side branch may have reserved the first parent's lane earlier; the older line keeps its colour.
  const recoloured =
    shared >= 0 && color < lanes[shared].color
      ? lanes.map((lane, position) =>
          position === shared ? { target: lane.target, color } : lane,
        )
      : lanes;
  return commit.parents.reduce(
    (state, parent, offset) => {
      if (findLane(state.lanes, parent) >= 0) return state;
      const laneColor = offset === 0 ? color : state.nextColor;
      const at = Math.min(index + offset, state.lanes.length);
      return {
        lanes: [
          ...state.lanes.slice(0, at),
          { target: parent, color: laneColor },
          ...state.lanes.slice(at),
        ],
        nextColor: offset > 0 ? state.nextColor + 1 : state.nextColor,
      };
    },
    { lanes: recoloured, nextColor: firstFreeColor },
  );
}

function step(state: LayoutState, commit: GraphCommit): LayoutState {
  const existing = findLane(state.lanes, commit.hash);
  // A ref head that no earlier row points at starts a new lane on the right.
  const index = existing >= 0 ? existing : state.lanes.length;
  const color = existing >= 0 ? state.lanes[existing].color : state.nextColor;
  const top =
    existing >= 0
      ? state.lanes
      : [...state.lanes, { target: commit.hash, color }];
  const nextColor = existing >= 0 ? state.nextColor : state.nextColor + 1;
  const without = top.filter((_, position) => position !== index);
  const placed = placeParents(without, commit, index, color, nextColor);
  const lanes = placed.lanes;
  const passThrough = top.flatMap((lane, position) => {
    const destination = findLane(lanes, lane.target);
    return position !== index && destination >= 0
      ? [{ from: position, to: destination, color: lane.color }]
      : [];
  });
  const parentEdges = commit.parents.flatMap((parent) => {
    const destination = findLane(lanes, parent);
    return destination >= 0
      ? [{ from: index, to: destination, color: lanes[destination].color }]
      : [];
  });
  const incoming =
    existing >= 0 ? [{ from: existing, to: existing, color }] : [];
  const row: GraphRow = {
    lane: index,
    color,
    incoming,
    outgoing: [...passThrough, ...parentEdges],
  };
  return {
    lanes,
    rows: [...state.rows, row],
    width: Math.max(state.width, top.length, lanes.length),
    nextColor: placed.nextColor,
  };
}

export function layoutGraph(commits: readonly GraphCommit[]): GraphLayout {
  const initial: LayoutState = { lanes: [], rows: [], width: 1, nextColor: 0 };
  // Rows are appended to a local array for speed; the result is a fresh value.
  const final = commits.reduce<LayoutState>((state, commit) => {
    const next = step({ ...state, rows: [] }, commit);
    state.rows.push(next.rows[0]);
    return { ...next, rows: state.rows };
  }, initial);
  return { rows: final.rows, columns: final.width };
}

export const LANE_WIDTH = 14;
export const GRAPH_INSET = 10;
/** Wider graphs are clipped so the message column keeps its room. */
export const MAX_VISIBLE_LANES = 12;

export function graphWidth(columns: number): number {
  return (
    Math.min(Math.max(columns, 1), MAX_VISIBLE_LANES) * LANE_WIDTH + GRAPH_INSET
  );
}

export function laneX(lane: number): number {
  return GRAPH_INSET / 2 + LANE_WIDTH / 2 + lane * LANE_WIDTH;
}
