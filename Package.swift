// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ratelgit",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "ratelgit", targets: ["RatelGit"])],
    targets: [
        .target(name: "RatelGitCore"),
        .executableTarget(name: "RatelGit", dependencies: ["RatelGitCore"]),
        .testTarget(name: "RatelGitCoreTests", dependencies: ["RatelGitCore", "RatelGit"])
    ]
)
