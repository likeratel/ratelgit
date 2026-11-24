import SwiftUI
import RatelGitCore

struct GraphEdge {
    let from: Int
    let to: Int
    let color: Int
}

struct CommitRow: Identifiable {
    let commit: GraphLine
    let lane: Int
    let color: Int
    let incoming: [GraphEdge]
    let outgoing: [GraphEdge]
    var id: Int { commit.id }
}

struct CommitGraph {
    let rows: [CommitRow]
    let columns: Int

    private struct Lane {
        let target: String
        let color: Int
    }

    init(_ lines: [GraphLine]) {
        var lanes: [Lane] = []
        var result: [CommitRow] = []
        var width = 1
        var nextColor = 0
        let commits = lines.filter { $0.hash != nil }
        for commit in commits {
            guard let hash = commit.hash else { continue }
            let existing = lanes.firstIndex { $0.target == hash }
            let index = existing ?? lanes.count
            let color = existing.map { lanes[$0].color } ?? nextColor
            if existing == nil {
                lanes.append(Lane(target: hash, color: color))
                nextColor += 1
            }
            let top = lanes
            lanes.remove(at: index)
            // A side branch may have reserved the first parent's lane earlier; the older line keeps its color.
            if let first = commit.parents.first,
               let shared = lanes.firstIndex(where: { $0.target == first }), color < lanes[shared].color {
                lanes[shared] = Lane(target: first, color: color)
            }
            for (offset, parent) in commit.parents.enumerated() where !lanes.contains(where: { $0.target == parent }) {
                let laneColor = offset == 0 ? color : nextColor
                if offset > 0 { nextColor += 1 }
                lanes.insert(Lane(target: parent, color: laneColor), at: min(index + offset, lanes.count))
            }
            let passThrough = top.enumerated().compactMap { position, lane -> GraphEdge? in
                guard position != index, let destination = lanes.firstIndex(where: { $0.target == lane.target }) else { return nil }
                return GraphEdge(from: position, to: destination, color: lane.color)
            }
            let parents = commit.parents.compactMap { parent -> GraphEdge? in
                guard let destination = lanes.firstIndex(where: { $0.target == parent }) else { return nil }
                return GraphEdge(from: index, to: destination, color: lanes[destination].color)
            }
            let incoming = existing.map { [GraphEdge(from: $0, to: $0, color: color)] } ?? []
            width = max(width, top.count, lanes.count)
            result.append(CommitRow(commit: commit, lane: index, color: color,
                                    incoming: incoming, outgoing: passThrough + parents))
        }
        rows = result
        columns = width
    }
}

struct GraphGlyph: View {
    let row: CommitRow
    let columns: Int
    private let palette: [Color] = [.teal, .orange, .indigo, .pink, .mint, .blue, .purple, .yellow]

    var body: some View {
        Canvas { context, size in
            let middle = size.height / 2
            let node = CGPoint(x: x(row.lane), y: middle)
            for edge in row.incoming {
                stroke(edge, start: 0, end: middle, context: context)
            }
            for edge in row.outgoing {
                let start = edge.from == row.lane ? middle : 0
                stroke(edge, start: start, end: size.height, context: context)
            }
            let ring = row.commit.parents.count > 1
            let radius: CGFloat = ring ? 5 : 4
            let dot = Path(ellipseIn: CGRect(x: node.x - radius, y: node.y - radius,
                                              width: radius * 2, height: radius * 2))
            let color = palette[row.color % palette.count]
            context.fill(dot, with: .color(ring ? Color(nsColor: .controlBackgroundColor) : color))
            context.stroke(dot, with: .color(color), lineWidth: 2)
        }
        .frame(width: CGFloat(columns * 17 + 8))
        .accessibilityHidden(true)
    }

    private func x(_ lane: Int) -> CGFloat { CGFloat(12 + lane * 17) }

    private func stroke(_ edge: GraphEdge, start: CGFloat, end: CGFloat, context: GraphicsContext) {
        let first = CGPoint(x: x(edge.from), y: start)
        let last = CGPoint(x: x(edge.to), y: end)
        let offset = (end - start) * 0.62
        var path = Path()
        path.move(to: first)
        path.addCurve(to: last, control1: CGPoint(x: first.x, y: start + offset),
                     control2: CGPoint(x: last.x, y: end - offset))
        context.stroke(path, with: .color(palette[edge.color % palette.count]), lineWidth: 1.7)
    }
}
