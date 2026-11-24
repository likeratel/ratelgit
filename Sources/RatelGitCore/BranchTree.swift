import Foundation

/// A branch or a folder of branches, split on `/`. Remote branches get their remote as the top folder.
public struct BranchNode: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let path: String
    public let reference: Reference?
    public let children: [BranchNode]

    public var isFolder: Bool { !children.isEmpty }
    /// Children in the optional form `List(children:)` expects.
    public var childNodes: [BranchNode]? { children.isEmpty ? nil : children }
    /// This node's branch and every branch below it.
    public var references: [Reference] { (reference.map { [$0] } ?? []) + children.flatMap(\.references) }
}

public enum BranchTree {
    public static func build(_ refs: [Reference]) -> [BranchNode] {
        nodes(refs.map { ($0, $0.name.split(separator: "/", omittingEmptySubsequences: false).map(String.init)) },
              prefix: "")
    }

    private static func nodes(_ entries: [(Reference, [String])], prefix: String) -> [BranchNode] {
        let groups = Dictionary(grouping: entries.filter { !$0.1.isEmpty }) { $0.1[0] }
        return groups.map { key, members in
            let path = prefix.isEmpty ? key : prefix + "/" + key
            let leaf = members.first { $0.1.count == 1 }?.0
            let deeper = members.filter { $0.1.count > 1 }.map { ($0.0, Array($0.1.dropFirst())) }
            let kind = members[0].0.kind.rawValue
            return BranchNode(id: leaf?.id ?? "folder:\(kind):\(path)", name: key, path: path, reference: leaf,
                              children: nodes(deeper, prefix: path))
        }
        .sorted(by: order)
    }

    /// Folders first, then names in case-insensitive order.
    private static func order(_ left: BranchNode, _ right: BranchNode) -> Bool {
        if left.isFolder != right.isFolder { return left.isFolder }
        let comparison = left.name.localizedCaseInsensitiveCompare(right.name)
        return comparison == .orderedSame ? left.name < right.name : comparison == .orderedAscending
    }
}
