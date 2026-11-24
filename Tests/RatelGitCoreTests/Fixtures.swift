import Foundation
import RatelGitCore
import XCTest
@testable import RatelGit

/// Gives each fixture command a later timestamp so commit dates read like real history.
enum FixtureClock {
    nonisolated(unsafe) private static var tick = 0
    private static let start = Date(timeIntervalSince1970: 1_772_000_000)

    static func next() -> String {
        tick += 1
        return "@\(Int(start.timeIntervalSince1970) + tick * 5_400) +0000"
    }
}

extension XCTestCase {
    func makeTemporaryDirectory() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        // Git reports real paths, and `resolvingSymlinksInPath` would strip `/private` instead.
        guard let real = realpath(root.path, nil) else { return root }
        defer { free(real) }
        return URL(fileURLWithPath: String(cString: real), isDirectory: true)
    }

    func shell(_ directory: URL, _ args: String...) throws {
        _ = try gitOutput(directory, args)
    }

    @discardableResult
    func gitOutput(_ directory: URL, _ args: [String], input: String? = nil) throws -> String {
        let process = Process()
        if let input {
            let pipe = Pipe()
            process.standardInput = pipe
            DispatchQueue.global().async {
                pipe.fileHandleForWriting.write(Data(input.utf8))
                try? pipe.fileHandleForWriting.close()
            }
        }
        let output = Pipe()
        let errors = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["-C", directory.path, "-c", "user.name=RatelGit Test",
                             "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false",
                             "-c", "tag.gpgsign=false", "-c", "init.defaultBranch=main"] + args
        let date = FixtureClock.next()
        process.environment = ProcessInfo.processInfo.environment.merging(
            ["GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date]
        ) { _, value in value }
        process.standardOutput = output
        process.standardError = errors
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let failure = errors.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw NSError(domain: "GitFixture", code: Int(process.terminationStatus),
                          userInfo: [NSLocalizedDescriptionKey: String(decoding: data + failure, as: UTF8.self)])
        }
        return String(decoding: data, as: UTF8.self)
    }

    func put(_ text: String, in directory: URL, _ file: String) throws {
        let url = directory.appendingPathComponent(file)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    func read(_ directory: URL, _ file: String) throws -> String {
        try String(contentsOf: directory.appendingPathComponent(file), encoding: .utf8)
    }

    func commitAll(_ directory: URL, _ message: String) throws {
        try shell(directory, "add", "-A")
        try shell(directory, "commit", "-q", "-m", message)
    }

    /// main with a merged side branch, `feature/x/y` and `fix/login` branches, a tag, and an `origin` remote
    /// whose branches lag behind.
    func makeSampleRepository(at root: URL, name: String = "sample") throws -> URL {
        let remote = root.appendingPathComponent("\(name)-remote.git")
        let repo = root.appendingPathComponent(name)
        try shell(root, "init", "-q", "--bare", "-b", "main", remote.path)
        try shell(root, "init", "-q", "-b", "main", repo.path)
        try shell(repo, "remote", "add", "origin", remote.path)
        try put("# Sample\n", in: repo, "README.md")
        try commitAll(repo, "Initial commit")
        try put("let value = 1\n", in: repo, "Sources/app.swift")
        try commitAll(repo, "Add app entry point")
        try shell(repo, "push", "-q", "-u", "origin", "main")
        try shell(repo, "switch", "-q", "-c", "side")
        try put("side\n", in: repo, "side.txt")
        try commitAll(repo, "Add side notes")
        try shell(repo, "switch", "-q", "main")
        try put("let value = 2\n", in: repo, "Sources/app.swift")
        try commitAll(repo, "Bump the value")
        try shell(repo, "merge", "-q", "--no-ff", "--no-edit", "side")
        try shell(repo, "tag", "-a", "v1.0", "-m", "Version 1.0")
        try shell(repo, "switch", "-q", "-c", "feature/x/y")
        try put("nested\n", in: repo, "nested.txt")
        try commitAll(repo, "Start nested feature")
        try shell(repo, "push", "-q", "origin", "feature/x/y")
        try put("nested more\n", in: repo, "nested.txt")
        try commitAll(repo, "Extend nested feature")
        try shell(repo, "switch", "-q", "-c", "fix/login", "main")
        try put("login fix\n", in: repo, "login.txt")
        try commitAll(repo, "Fix login redirect")
        try shell(repo, "switch", "-q", "main")
        try shell(repo, "fetch", "-q", "origin")
        return repo
    }

    /// A linear `main` with `count` empty commits, written in one `fast-import` so it stays quick.
    func makeLongHistory(at directory: URL, count: Int) throws {
        try shell(directory, "init", "-q", "-b", "main")
        let stream = (1...count).map { index in
            let parent = index > 1 ? "from :\(index - 1)\n" : ""
            let message = "Commit \(index)"
            return "commit refs/heads/main\nmark :\(index)\ncommitter Test <test@example.invalid> \(1_700_000_000 + index) +0000\n"
                + "data \(message.utf8.count)\n\(message)\n\(parent)"
        }.joined(separator: "\n")
        try gitOutput(directory, ["fast-import", "--quiet"], input: stream + "\n")
        try shell(directory, "reset", "-q", "--hard", "main")
    }

    @MainActor
    func waitUntilIdle(_ model: BrowserModel, expectError: Bool = false,
                       file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now + .seconds(10)
        while (model.loading || model.loadingPage || model.mutation != nil) && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertFalse(model.loading, file: file, line: line)
        XCTAssertNil(model.mutation, file: file, line: line)
        if expectError {
            XCTAssertNotNil(model.error, file: file, line: line)
        } else {
            XCTAssertNil(model.error, file: file, line: line)
        }
    }
}
