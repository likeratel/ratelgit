import AppKit
import SwiftUI
import RatelGitCore

struct PatchLine: Equatable {
    enum Kind { case context, added, removed, header }
    let text: String
    let old: Int?
    let new: Int?
    let kind: Kind
}

struct PatchRow: Identifiable {
    let id: Int
    let left: PatchLine?
    let right: PatchLine?
}

struct PatchDocument {
    let lines: [PatchLine]
    private static let hunk = #/^@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@/#

    init(_ patch: String) {
        var old: Int?
        var new: Int?
        lines = patch.split(separator: "\n", omittingEmptySubsequences: false).dropLast(patch.hasSuffix("\n") ? 1 : 0)
            .map { line in
                if let match = line.prefixMatch(of: Self.hunk) {
                    old = Int(match.1)
                    new = Int(match.2)
                } else if let previous = old, let current = new {
                    let text = String(line.dropFirst())
                    switch line.first {
                    case " ":
                        old = previous + 1
                        new = current + 1
                        return PatchLine(text: text, old: previous, new: current, kind: .context)
                    case "+":
                        new = current + 1
                        return PatchLine(text: text, old: nil, new: current, kind: .added)
                    case "-":
                        old = previous + 1
                        return PatchLine(text: text, old: previous, new: nil, kind: .removed)
                    default: break
                    }
                }
                return PatchLine(text: String(line), old: nil, new: nil, kind: .header)
            }
    }

    var splitRows: [PatchRow] {
        var result: [PatchRow] = []
        var left: [PatchLine] = []
        var right: [PatchLine] = []
        func appendChanges() {
            for index in 0..<max(left.count, right.count) {
                result.append(PatchRow(id: result.count, left: left.indices.contains(index) ? left[index] : nil,
                                       right: right.indices.contains(index) ? right[index] : nil))
            }
            left.removeAll(keepingCapacity: true)
            right.removeAll(keepingCapacity: true)
        }
        for line in lines {
            switch line.kind {
            case .removed: left.append(line)
            case .added: right.append(line)
            case .header, .context:
                appendChanges()
                result.append(PatchRow(id: result.count, left: line, right: line.kind == .context ? line : nil))
            }
        }
        appendChanges()
        return result
    }
}

struct DiffInspector: View {
    @ObservedObject var model: BrowserModel
    let includeFiles: Bool
    @State private var split = false

    var body: some View {
        VSplitView {
            if includeFiles {
                VStack(alignment: .leading, spacing: 0) {
                    Text(model.commit.map { "Commit \($0.prefix(8))" } ?? "Working Changes")
                        .font(.headline).padding(12)
                    Divider()
                    if model.files.isEmpty {
                        ContentUnavailableView("No changed files", systemImage: "doc")
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        List(model.files) { file in FileRow(file: file, model: model) }.listStyle(.inset)
                    }
                }
                .frame(minHeight: 110, idealHeight: 155)
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(model.file?.path ?? "Diff").font(.headline)
                        .lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Picker("Diff layout", selection: $split) {
                        Text("Unified").tag(false)
                        Text("Split").tag(true)
                    }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                }
                .padding(12)
                Divider()
                if model.patch.isEmpty {
                    ContentUnavailableView(model.file == nil ? "Select a file" : model.loading ? "Reading diff…" : "No text diff",
                                           systemImage: "doc.text.magnifyingglass")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    PatchView(patch: model.patch, split: split).id(model.file)
                }
            }
            .frame(minHeight: 220, maxHeight: .infinity, alignment: .top)
        }
    }
}

struct PatchView: View {
    let patch: String
    let split: Bool
    private static let codeSize: CGFloat = 12

    var body: some View {
        let document = PatchDocument(patch)
        GeometryReader { geometry in
            ScrollView([.vertical, .horizontal]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if split {
                        let width = max(geometry.size.width, (longestLine(in: document) + 56) * 2)
                        ForEach(document.splitRows) { row in splitRow(row, width: width) }
                    } else {
                        ForEach(Array(document.lines.enumerated()), id: \.offset) { _, line in
                            HStack(spacing: 0) {
                                gutter(line.old)
                                gutter(line.new)
                                Text(prefix(line) + line.text).padding(.horizontal, 6)
                                Spacer(minLength: 0)
                            }
                            .frame(minWidth: geometry.size.width, minHeight: 20)
                            .background(tint(line.kind))
                        }
                    }
                }
                .font(.system(size: Self.codeSize, design: .monospaced))
                .textSelection(.enabled)
            }
        }
    }

    private func longestLine(in document: PatchDocument) -> CGFloat {
        let font = NSFont.monospacedSystemFont(ofSize: Self.codeSize, weight: .regular)
        return document.lines.lazy.filter { $0.kind != .header }.map { line in
            let text = line.text.replacingOccurrences(of: "\t", with: "    ")
            return (text as NSString).size(withAttributes: [.font: font]).width.rounded(.up)
        }.max() ?? 0
    }

    @ViewBuilder
    private func splitRow(_ row: PatchRow, width: CGFloat) -> some View {
        if let line = row.left, line.kind == .header {
            Text(line.text).padding(.horizontal, 8).frame(minWidth: width, minHeight: 20, alignment: .leading)
                .background(tint(.header))
        } else {
            HStack(spacing: 0) {
                cell(row.left, number: row.left?.old, width: width / 2)
                cell(row.right, number: row.right?.new, width: width / 2)
            }
        }
    }

    private func cell(_ line: PatchLine?, number: Int?, width: CGFloat) -> some View {
        HStack(spacing: 0) {
            gutter(number)
            Text(line?.text.replacingOccurrences(of: "\t", with: "    ") ?? "").lineLimit(1).fixedSize().padding(.horizontal, 6)
            Spacer(minLength: 0)
        }
        .frame(width: width, height: 20)
        .background(tint(line?.kind))
    }

    private func gutter(_ value: Int?) -> some View {
        Text(value.map(String.init) ?? "").foregroundStyle(.secondary)
            .frame(width: 37, alignment: .trailing).padding(.trailing, 5)
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

    private func tint(_ kind: PatchLine.Kind?) -> Color {
        switch kind {
        case .added: return .green.opacity(0.14)
        case .removed: return .red.opacity(0.14)
        case .header: return .blue.opacity(0.11)
        case .context: return .clear
        case nil: return .secondary.opacity(0.08)
        }
    }
}
