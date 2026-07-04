// 用 CoreGraphics 程序化绘制拾光日报的应用图标与菜单栏托盘模板图。见 docs/SPEC.md §14。
//
// 用法：swift make-icons.swift <app|tray> <size> <output.png>
//   app  —— #D97757 圆角矩形（22% 圆角）底 + #FAF9F5 极简旭日几何（底部横线 + 其上半圆 + 三条短射线）。
//   tray —— 透明底 + 黑色 alpha 的同款旭日线条几何，用作 macOS 菜单栏 template 图（系统只取 alpha）。
//
// 单独产出各尺寸 PNG，由 make-icons.sh 汇集成 .iconset -> iconutil 出 .icns，并直接产出 22/44 托盘图。
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 4, let size = Int(args[2]), size > 0 else {
    FileHandle.standardError.write(Data("usage: make-icons.swift <app|tray> <size> <output.png>\n".utf8))
    exit(1)
}
let mode = args[1]
let outputPath = args[3]
let S = CGFloat(size)

let colorSpace = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    FileHandle.standardError.write(Data("failed to create CGContext\n".utf8))
    exit(1)
}

ctx.setAllowsAntialiasing(true)
ctx.setShouldAntialias(true)
ctx.interpolationQuality = .high
ctx.clear(CGRect(x: 0, y: 0, width: S, height: S))

/// 在以 (cx, cy) 为几何中心、边长 L 的正方形艺术区内绘制“旭日”线条几何。
/// 坐标系为 CoreGraphics 位图默认的左下原点（y 向上）。
func drawSunrise(cx: CGFloat, cy: CGFloat, L: CGFloat, color: CGColor, lineWidth: CGFloat) {
    ctx.setStrokeColor(color)
    ctx.setLineWidth(lineWidth)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)

    // 地平线（横线）：略低于几何中心，作为“旭日”升起的基线。
    let baseY = cy - 0.11 * L
    ctx.beginPath()
    ctx.move(to: CGPoint(x: cx - 0.30 * L, y: baseY))
    ctx.addLine(to: CGPoint(x: cx + 0.30 * L, y: baseY))
    ctx.strokePath()

    // 半圆（太阳的上半轮廓）：坐落在基线上，向上鼓起。
    let r = 0.165 * L
    ctx.beginPath()
    ctx.addArc(center: CGPoint(x: cx, y: baseY), radius: r, startAngle: 0, endAngle: .pi, clockwise: false)
    ctx.strokePath()

    // 三条短射线：自太阳上方向外辐射，一条竖直、两条 ±45° 斜向，对称大气。
    let ri = 0.22 * L
    let ro = 0.335 * L
    let angles: [CGFloat] = [.pi / 2, .pi / 4, 3 * .pi / 4]
    ctx.beginPath()
    for a in angles {
        let x1 = cx + ri * cos(a)
        let y1 = baseY + ri * sin(a)
        let x2 = cx + ro * cos(a)
        let y2 = baseY + ro * sin(a)
        ctx.move(to: CGPoint(x: x1, y: y1))
        ctx.addLine(to: CGPoint(x: x2, y: y2))
    }
    ctx.strokePath()
}

if mode == "app" {
    // #D97757 圆角矩形背景（22% 圆角），四周留白约 10% 以贴合 macOS 悬浮方块的观感。
    let margin = 0.10 * S
    let rectSide = S - 2 * margin
    let rectFrame = CGRect(x: margin, y: margin, width: rectSide, height: rectSide)
    let radius = 0.22 * rectSide
    let bg = CGPath(roundedRect: rectFrame, cornerWidth: radius, cornerHeight: radius, transform: nil)
    ctx.addPath(bg)
    ctx.setFillColor(CGColor(red: 0xD9 / 255.0, green: 0x77 / 255.0, blue: 0x57 / 255.0, alpha: 1.0))
    ctx.fillPath()

    let cream = CGColor(red: 0xFA / 255.0, green: 0xF9 / 255.0, blue: 0xF5 / 255.0, alpha: 1.0)
    drawSunrise(cx: rectFrame.midX, cy: rectFrame.midY, L: rectSide, color: cream, lineWidth: 0.05 * rectSide)
} else if mode == "tray" {
    // 菜单栏 template 图：透明底 + 纯黑 alpha 几何（系统按 alpha 遮罩并自适应明暗色）。
    let black = CGColor(red: 0, green: 0, blue: 0, alpha: 1.0)
    let L = S * 0.86
    drawSunrise(cx: S / 2, cy: S / 2, L: L, color: black, lineWidth: max(1.4, 0.085 * S))
} else {
    FileHandle.standardError.write(Data("unknown mode: \(mode) (expected 'app' or 'tray')\n".utf8))
    exit(1)
}

guard let image = ctx.makeImage() else {
    FileHandle.standardError.write(Data("failed to render image\n".utf8))
    exit(1)
}
let url = URL(fileURLWithPath: outputPath)
guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    FileHandle.standardError.write(Data("failed to create PNG destination\n".utf8))
    exit(1)
}
CGImageDestinationAddImage(dest, image, nil)
guard CGImageDestinationFinalize(dest) else {
    FileHandle.standardError.write(Data("failed to finalize PNG\n".utf8))
    exit(1)
}
