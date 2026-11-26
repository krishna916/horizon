"""Regenerate the tiny deterministic animation fixtures; requires Pillow with WebP support."""

from pathlib import Path

from PIL import Image

OUTPUT = Path(__file__).parent
frames = [
    Image.new("RGBA", (4, 3), (240, 30, 20, 255)),
    Image.new("RGBA", (4, 3), (20, 30, 240, 255)),
]
frames[0].save(OUTPUT / "static.webp", format="WEBP", lossless=True)
frames[0].save(
    OUTPUT / "animated.webp",
    format="WEBP",
    save_all=True,
    append_images=frames[1:],
    duration=100,
    loop=0,
    lossless=True,
)
frames[0].save(
    OUTPUT / "animated.gif", format="GIF", save_all=True, append_images=frames[1:], duration=100, loop=0
)
frames = [
    Image.new("RGBA", (2, 2), (i % 255, (i * 2) % 255, (i * 3) % 255, 255))
    for i in range(101)
]
frames[0].save(
    OUTPUT / "animated-100.webp",
    format="WEBP",
    save_all=True,
    append_images=frames[1:100],
    duration=10,
    loop=0,
    lossless=True,
)
frames[0].save(
    OUTPUT / "animated-101.webp",
    format="WEBP",
    save_all=True,
    append_images=frames[1:],
    duration=10,
    loop=0,
    lossless=True,
)
