import {
  graphWidth,
  laneX,
  type GraphEdge,
  type GraphRow,
} from "../../lib/graph";

const ROW = 28;
const MID = ROW / 2;

const color = (index: number) => `var(--graph-${index % 10})`;

function edgePath(edge: GraphEdge, start: number, end: number): string {
  const x1 = laneX(edge.from);
  const x2 = laneX(edge.to);
  if (x1 === x2) return `M${x1} ${start}V${end}`;
  const bend = (end - start) * 0.62;
  return `M${x1} ${start}C${x1} ${start + bend} ${x2} ${end - bend} ${x2} ${end}`;
}

interface Props {
  row: GraphRow;
  columns: number;
  merge: boolean;
}

/** One row of the commit graph: lines through the row and the commit's node. */
export function GraphCell({ row, columns, merge }: Props) {
  const width = graphWidth(columns);
  return (
    <svg
      className="graph-cell"
      width={width}
      height={ROW}
      viewBox={`0 0 ${width} ${ROW}`}
      aria-hidden="true"
    >
      {row.incoming.map((edge, i) => (
        <path
          key={`i${i}`}
          d={edgePath(edge, 0, MID)}
          stroke={color(edge.color)}
        />
      ))}
      {row.outgoing.map((edge, i) => (
        <path
          key={`o${i}`}
          d={edgePath(edge, edge.from === row.lane ? MID : 0, ROW)}
          stroke={color(edge.color)}
        />
      ))}
      <circle
        cx={laneX(row.lane)}
        cy={MID}
        r={merge ? 4.5 : 4}
        className={merge ? "graph-node merge" : "graph-node"}
        style={{ color: color(row.color) }}
      />
    </svg>
  );
}

export const GRAPH_ROW_HEIGHT = ROW;
