// The Mark It Down brand mark — the same art as media/brand/icon.svg (navy →
// indigo rounded square, warm cream→amber italic "#"), drawn natively so it
// renders crisp at any size without an asset.
import 'dart:math' as math;
import 'package:flutter/material.dart';

class MarkItDownMark extends StatelessWidget {
  final double size;
  const MarkItDownMark({super.key, this.size = 64});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(size: Size.square(size), painter: _MarkPainter());
  }
}

class _MarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 1024; // the SVG's 1024 viewBox
    final rect = Rect.fromLTWH(64 * s, 64 * s, 896 * s, 896 * s);
    final page = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft, end: Alignment.bottomRight,
        colors: [Color(0xFF1D2333), Color(0xFF3B3A7A)],
      ).createShader(rect);
    canvas.drawRRect(RRect.fromRectAndRadius(rect, Radius.circular(200 * s)), page);

    // subtle top sheen
    final sheen = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topCenter, end: Alignment.bottomCenter,
        colors: [Color(0x2EFFFFFF), Color(0x00FFFFFF)],
        stops: [0, 0.45],
      ).createShader(rect);
    canvas.drawRRect(RRect.fromRectAndRadius(rect, Radius.circular(200 * s)), sheen);

    final hash = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter, end: Alignment.bottomCenter,
        colors: const [Color(0xFFFFF5D8), Color(0xFFF7C97B)],
      ).createShader(rect);

    RRect bar(double x, double y, double w, double h) =>
        RRect.fromRectAndRadius(Rect.fromLTWH(x * s, y * s, w * s, h * s), Radius.circular(46 * s));

    // vertical bars, skewed -8° around the center (like the SVG's skewX)
    canvas.save();
    canvas.translate(512 * s, 512 * s);
    canvas.transform((Matrix4.identity()..setEntry(0, 1, math.tan(-8 * math.pi / 180))).storage);
    canvas.translate(-512 * s, -512 * s);
    canvas.drawRRect(bar(350, 232, 92, 560), hash);
    canvas.drawRRect(bar(582, 232, 92, 560), hash);
    canvas.restore();

    // horizontal bars (level)
    canvas.drawRRect(bar(232, 402, 560, 92), hash);
    canvas.drawRRect(bar(232, 566, 560, 92), hash);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
