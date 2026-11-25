# File validation fixtures

These fixtures contain generated solid-color test pixels only; they contain no user data.

- `static.webp`, `animated.webp`, `animated-100.webp`, `animated-101.webp` and `animated.gif` were generated with Pillow 12.1.1 and libwebp 1.5.0. The animated files use 4×3 or 2×2 frames so frame counting and cumulative-pixel checks do not depend on large checked-in binaries.
- JPEG, PNG and static GIF samples are generated in the Java tests with the JDK ImageIO writers.
- PDF samples are generated from a minimal in-test PDF object/xref builder.
- DOCX/XLSX/PPTX package parts and malformed/unsafe package entries are generated in the Java tests.

The WebP/GIF binaries can be reproduced with `generate_fixtures.py` from this directory. Pillow is a fixture-generation tool only and is not a Horizon runtime or test dependency.
