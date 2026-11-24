import AppKit
import SwiftUI
import RatelGitCore

/// Hunk and line actions offered for a working-tree diff.
struct LineStaging {
    let operations: [LineOperation]
    let selection: Set<Int>
    let toggle: (Int) -> Void
    /// Runs an operation on a whole hunk, identified by its header line index.
    let hunk: (LineOperation, Int) -> Void
}

struct PatchView: View {
    let document: PatchDocument
    let split: Bool
    var staging: LineStaging?
    private static let codeSize: CGFloat = 12
    private static let rowHeight: CGFloat = 20
    private static let gutterWidth: CGFloat = 37
    private static let selectorWidth: CGFloat = 18
    private static let tabReplacement = "    "

    var body: some View {
        GeometryReader { geometry in
            ScrollView([.vertical, .horizontal]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if split {
                        let width = max(geometry.size.width, (longestLine + 56 + selectorSpace) * 2)
                        ForEach(document.splitRows) { row in splitRow(row, width: width) }
                    } else {
                        ForEach(document.displayLines, id: \.index) { line in unifiedRow(line, width: geometry.size.width) }
                    }
                }
                .font(.system(size: Self.codeSize, design: .monospaced))
                .textSelection(.enabled)
            }
        }
    }

    private var selectorSpace: CGFloat { staging == nil ? 0 : Self.selectorWidth }

    private var longestLine: CGFloat {
        let font = NSFont.monospacedSystemFont(ofSize: Self.codeSize, weight: .regular)
        return document.lines.lazy.filter { $0.kind != .header }.map { line in
            let text = line.text.replacingOccurrences(of: "\t", with: Self.tabReplacement)
            return (text as NSString).size(withAttributes: [.font: font]).width.rounded(.up)
        }.max() ?? 0
    }

    @ViewBuilder
    private func unifiedRow(_ line: PatchLine, width: CGFloat) -> some View {
        if line.kind == .header {
            headerRow(line, width: width)
        } else {
            HStack(spacing: 0) {
                selector(line)
                gutter(line.old)
                gutter(line.new)
                Text(Self.styled(prefix(line), line)).lineLimit(1).fixedSize().padding(.horizontal, 6)
                Spacer(minLength: 0)
            }
            .frame(minWidth: width, minHeight: Self.rowHeight)
            .background(tint(line))
        }
    }

    private func headerRow(_ line: PatchLine, width: CGFloat) -> some View {
        HStack(spacing: 8) {
            Text(line.text).foregroundStyle(.secondary).lineLimit(1).fixedSize()
            if line.isHunkHeader, let staging {
                ForEach(staging.operations, id: \.self) { operation in
                    Button(operation == .discard ? "Discard Hunk…" : "\(operation.rawValue) Hunk") {
                        staging.hunk(operation, line.index)
                    }
                    .font(.system(size: 11)).controlSize(.mini)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .frame(minWidth: width, minHeight: line.isHunkHeader && staging != nil ? 26 : Self.rowHeight, alignment: .leading)
        .background(Color.blue.opacity(0.09))
    }

    @ViewBuilder
    private func splitRow(_ row: PatchRow, width: CGFloat) -> some View {
        if let line = row.left, line.kind == .header {
            headerRow(line, width: width)
        } else {
            HStack(spacing: 0) {
                cell(row.left, number: row.left?.old, width: width / 2)
                Divider()
                cell(row.right, number: row.right?.new, width: width / 2)
            }
        }
    }

    private func cell(_ line: PatchLine?, number: Int?, width: CGFloat) -> some View {
        HStack(spacing: 0) {
            if let line { selector(line) } else if staging != nil { Color.clear.frame(width: Self.selectorWidth) }
            gutter(number)
            Text(line.map { Self.styled("", $0) } ?? AttributedString()).lineLimit(1).fixedSize().padding(.horizontal, 6)
            Spacer(minLength: 0)
        }
        .frame(width: width, height: Self.rowHeight)
        .background(line.map(tint) ?? Color.secondary.opacity(0.08))
    }

    @ViewBuilder
    private func selector(_ line: PatchLine) -> some View {
        if let staging {
            if line.isChange {
                let selected = staging.selection.contains(line.index)
                Button { staging.toggle(line.index) } label: {
                    Image(systemName: selected ? "checkmark.square.fill" : "square")
                        .font(.system(size: 10))
                        .foregroundStyle(selected ? Color.accentColor : Color.secondary.opacity(0.6))
                        .frame(width: Self.selectorWidth, height: Self.rowHeight)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(selected ? "Deselect line" : "Select line to stage, unstage or discard")
            } else {
                Color.clear.frame(width: Self.selectorWidth, height: Self.rowHeight)
            }
        }
    }

    private func gutter(_ value: Int?) -> some View {
        Text(value.map(String.init) ?? "").foregroundStyle(.secondary)
            .frame(width: Self.gutterWidth, alignment: .trailing).padding(.trailing, 5)
            .accessibilityHidden(value == nil)
    }

    private func prefix(_ line: PatchLine) -> String {
        switch line.kind {
        case .added: return "+ "
        case .removed: return "− "
        case .context: return "  "
        case .header: return ""
        }
    }

    private func tint(_ line: PatchLine) -> Color {
        let selected = staging?.selection.contains(line.index) == true
        switch line.kind {
        case .added: return .green.opacity(selected ? 0.3 : 0.13)
        case .removed: return .red.opacity(selected ? 0.3 : 0.13)
        case .header: return .blue.opacity(0.09)
        case .context: return .clear
        }
    }

    /// Text with tabs expanded and the word-level differences on a stronger background.
    static func styled(_ prefix: String, _ line: PatchLine) -> AttributedString {
        let characters = Array(line.text)
        let strong: Color = line.kind == .added ? .green.opacity(0.38) : .red.opacity(0.38)
        var result = AttributedString(prefix)
        var cursor = 0
        func append(_ range: Range<Int>, emphasized: Bool) {
            guard !range.isEmpty else { return }
            var piece = AttributedString(String(characters[range]).replacingOccurrences(of: "\t", with: tabReplacement))
            if emphasized { piece.backgroundColor = strong }
            result.append(piece)
        }
        for range in line.emphasis.sorted(by: { $0.lowerBound < $1.lowerBound })
        where range.lowerBound >= cursor && range.upperBound <= characters.count {
            append(cursor..<range.lowerBound, emphasized: false)
            append(range, emphasized: true)
            cursor = range.upperBound
        }
        append(cursor..<characters.count, emphasized: false)
        return result
    }
}
