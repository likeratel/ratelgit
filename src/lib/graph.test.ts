import { describe, expect, it } from "vitest";
import { layoutGraph, type GraphCommit, type GraphLayout } from "./graph";

const commit = (hash: string, ...parents: string[]): GraphCommit => ({
  hash,
  parents,
});

/** Every lane at the bottom of a row continues at the top of the next one. */
function expectContinuous(layout: GraphLayout) {
  layout.rows.slice(1).forEach((below, offset) => {
    const above = layout.rows[offset];
    const bottom = new Set(above.outgoing.map((edge) => edge.to));
    const top = new Set([
      ...below.incoming.map((edge) => edge.from),
      ...below.outgoing
        .filter((edge) => edge.from !== below.lane)
        .map((edge) => edge.from),
    ]);
    expect([...top].sort()).toEqual([...bottom].sort());
    if (below.incoming.length === 0) expect(below.lane).toBe(bottom.size);
  });
}

// The sample repository of the Rust tests: main with a merged side branch, a nested feature
// and a login fix, listed in `git log --topo-order` order.
const sample = [
  commit("fix", "merge"),
  commit("ext", "start"),
  commit("start", "merge"),
  commit("merge", "bump", "side"),
  commit("side", "app"),
  commit("bump", "app"),
  commit("app", "init"),
  commit("init"),
];

describe("layoutGraph", () => {
  it("keeps every lane continuous and opens new heads on the right", () => {
    const layout = layoutGraph(sample);
    expectContinuous(layout);
    expect(layout.rows[0].lane).toBe(0);
    expect(layout.rows[1].lane).toBe(1);
    expect(layout.rows.at(-1)?.outgoing).toEqual([]);
  });

  it("draws a merge with two parent edges and gives the main line its colour", () => {
    const layout = layoutGraph([
      commit("m", "main", "side"),
      commit("side", "base"),
      commit("main", "base"),
      commit("base"),
    ]);
    expect(layout.columns).toBe(2);
    expect(layout.rows[0].outgoing.map((edge) => edge.to).sort()).toEqual([
      0, 1,
    ]);
    expect(layout.rows[3].color).toBe(layout.rows[0].color);
    expectContinuous(layout);
  });

  it("stays continuous with many heads", () => {
    const layout = layoutGraph([
      commit("t0", "merge"),
      commit("t1", "bump"),
      commit("t2", "merge"),
      commit("t3", "bump"),
      ...sample,
    ]);
    expectContinuous(layout);
    expect(layout.columns).toBeGreaterThanOrEqual(3);
    layout.rows.forEach((row, index) => {
      const own = row.outgoing.filter((edge) => edge.from === row.lane);
      const parents = [
        commit("t0", "merge"),
        commit("t1", "bump"),
        commit("t2", "merge"),
        commit("t3", "bump"),
        ...sample,
      ][index].parents;
      expect(own.length).toBe(parents.length);
    });
  });

  it("keeps earlier rows when a page is appended and leaves lanes open at the edge", () => {
    const whole = layoutGraph(sample);
    const firstPage = layoutGraph(sample.slice(0, 3));
    expect(firstPage.rows).toEqual(whole.rows.slice(0, 3));
    expect(firstPage.rows.at(-1)?.outgoing.length).toBeGreaterThan(0);
  });

  it("keeps a long linear history in one lane", () => {
    const linear = Array.from({ length: 520 }, (_, i) =>
      commit(`c${i}`, ...(i < 519 ? [`c${i + 1}`] : [])),
    );
    const page = layoutGraph(linear.slice(0, 500));
    expect(page.rows.at(-1)?.outgoing.length).toBe(1);
    const layout = layoutGraph(linear);
    expect(new Set(layout.rows.map((row) => row.lane))).toEqual(new Set([0]));
  });
});
