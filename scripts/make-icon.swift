// Draws the ratelgit app icon: a honey badger's two-tone coat with a commit graph on top.
// Usage: swift scripts/make-icon.swift <output.png>
import AppKit

let size: CGFloat = 1024
let output = CommandLine.arguments.dropFirst().first ?? "icon.png"

func color(_ hex: UInt32) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255, alpha: 1)
}

func gradient(_ context: CGContext, _ top: UInt32, _ bottom: UInt32, from: CGFloat, to: CGFloat) {
    let colors = [color(top), color(bottom)] as CFArray
    guard let fill = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) else { return }
    context.drawLinearGradient(fill, start: CGPoint(x: 0, y: from), end: CGPoint(x: 0, y: to), options: [])
}

guard let context = CGContext(data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }

let plate = CGRect(x: 100, y: 100, width: 824, height: 824)
let shape = CGPath(roundedRect: plate, cornerWidth: 186, cornerHeight: 186, transform: nil)

context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: CGColor(gray: 0, alpha: 0.35))
context.addPath(shape)
context.setFillColor(color(0x17181c))
context.fillPath()
context.restoreGState()

context.saveGState()
context.addPath(shape)
context.clip()
gradient(context, 0x30333b, 0x131418, from: plate.maxY, to: plate.minY)

// The pale mantle that runs along a honey badger's back.
let mantle = CGMutablePath()
mantle.move(to: CGPoint(x: plate.minX, y: 610))
mantle.addCurve(to: CGPoint(x: plate.maxX, y: 700), control1: CGPoint(x: 380, y: 520), control2: CGPoint(x: 660, y: 760))
mantle.addLine(to: CGPoint(x: plate.maxX, y: plate.maxY))
mantle.addLine(to: CGPoint(x: plate.minX, y: plate.maxY))
mantle.closeSubpath()
context.saveGState()
context.addPath(mantle)
context.clip()
gradient(context, 0xfaf7ef, 0xd3cdc0, from: plate.maxY, to: 560)
context.restoreGState()
context.restoreGState()

let honey: UInt32 = 0xf5a623
let teal: UInt32 = 0x2bb3a3
let ink: UInt32 = 0x17181c
let root = CGPoint(x: 400, y: 262)
let middle = CGPoint(x: 400, y: 512)
let head = CGPoint(x: 400, y: 762)
let side = CGPoint(x: 640, y: 512)

func stroke(_ path: CGPath, _ hex: UInt32) {
    context.setLineCap(.round)
    context.addPath(path)
    context.setStrokeColor(color(ink))
    context.setLineWidth(72)
    context.strokePath()
    context.addPath(path)
    context.setStrokeColor(color(hex))
    context.setLineWidth(44)
    context.strokePath()
}

let branch = CGMutablePath()
branch.move(to: root)
branch.addCurve(to: side, control1: CGPoint(x: 400, y: 400), control2: CGPoint(x: 640, y: 380))
branch.addCurve(to: head, control1: CGPoint(x: 640, y: 644), control2: CGPoint(x: 400, y: 624))
stroke(branch, teal)

let trunk = CGMutablePath()
trunk.move(to: root)
trunk.addLine(to: head)
stroke(trunk, honey)

func node(_ point: CGPoint, _ hex: UInt32) {
    let outer = CGRect(x: point.x - 62, y: point.y - 62, width: 124, height: 124)
    context.setFillColor(color(ink))
    context.fillEllipse(in: outer)
    context.setFillColor(color(hex))
    context.fillEllipse(in: outer.insetBy(dx: 14, dy: 14))
    context.setFillColor(color(ink))
    context.fillEllipse(in: outer.insetBy(dx: 40, dy: 40))
}
node(root, honey)
node(middle, honey)
node(head, honey)
node(side, teal)

guard let image = context.makeImage(),
      let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { exit(1) }
do { try png.write(to: URL(fileURLWithPath: output)) } catch {
    FileHandle.standardError.write(Data("Could not write \(output): \(error.localizedDescription)\n".utf8))
    exit(1)
}
