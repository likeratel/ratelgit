/**
 * Branches as a folder tree split on `/`. Remote branches get their remote as the top folder.
 */

export interface TreeRef {
  id: string;
  name: string;
  kind: string;
}

export interface BranchNode<R extends TreeRef = TreeRef> {
  id: string;
  name: string;
  /** Path of this node within the tree, e.g. `feature/x`. */
  path: string;
  reference: R | null;
  children: BranchNode<R>[];
}

interface Entry<R> {
  ref: R;
  parts: string[];
}

const collator = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});

/** Folders first, then names in case-insensitive order. */
function order(left: BranchNode, right: BranchNode): number {
  const leftFolder = left.children.length > 0;
  const rightFolder = right.children.length > 0;
  if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;
  const compared = collator.compare(left.name, right.name);
  if (compared !== 0) return compared;
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function nodes<R extends TreeRef>(
  entries: Entry<R>[],
  prefix: string,
): BranchNode<R>[] {
  const groups = new Map<string, Entry<R>[]>();
  entries
    .filter((entry) => entry.parts.length > 0)
    .forEach((entry) => {
      const key = entry.parts[0];
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    });
  return [...groups.entries()]
    .map(([key, members]) => {
      const path = prefix ? `${prefix}/${key}` : key;
      const leaf = members.find((m) => m.parts.length === 1)?.ref ?? null;
      const deeper = members
        .filter((m) => m.parts.length > 1)
        .map((m) => ({ ref: m.ref, parts: m.parts.slice(1) }));
      const kind = members[0].ref.kind;
      return {
        id: leaf?.id ?? `folder:${kind}:${path}`,
        name: key,
        path,
        reference: leaf,
        children: nodes(deeper, path),
      };
    })
    .sort(order);
}

export function buildBranchTree<R extends TreeRef>(
  refs: readonly R[],
): BranchNode<R>[] {
  return nodes(
    refs.map((ref) => ({ ref, parts: ref.name.split("/") })),
    "",
  );
}

/** This node's branch and every branch below it. */
export function refsBelow<R extends TreeRef>(node: BranchNode<R>): R[] {
  return [
    ...(node.reference ? [node.reference] : []),
    ...node.children.flatMap((child) => refsBelow(child)),
  ];
}

export function isFolder(node: BranchNode): boolean {
  return node.children.length > 0;
}
