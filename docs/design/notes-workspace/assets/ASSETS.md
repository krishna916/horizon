# Local review assets

| Asset                                                | Source / role                                                                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geist-latin-wght-normal.woff2`, `GEIST-LICENSE.txt` | Reused from approved Tasks mockup; SIL Open Font License included.                                                                                             |
| `kyoto-garden.png`                                   | Generated with the built-in ImageGen tool on 2026-11-08. Illustrative travel-note content, not a photograph of a verified real place or a product cover image. |
| `kyoto-itinerary.pdf`                                | Original one-page sample generated with ReportLab; embedded DejaVu Sans font. No bookings or real travel arrangements. Native PDF-preview fixture.             |
| `kyoto-itinerary-preview.png`, `DEJAVU-LICENSE.txt`  | Rendered first-page fallback for the in-app browser, which did not display its native PDF embed; font license for embedded DejaVu Sans.                        |
| `travel-research.md`                                 | Original read-only Markdown-preview fixture including a Mermaid fence; real original download.                                                                 |
| `note-flow.mmd`                                      | Original four-node Mermaid fixture; mockup displays a deterministic SVG representation. No Mermaid dependency added.                                           |
| `packing-list.csv`                                   | Original CSV fixture for the download-only file surface.                                                                                                       |
| Outline icons                                        | Local SVG paths in `mockup.js`, following Horizon’s existing simple stroke vocabulary. No icon/font network dependency.                                        |

ImageGen prompt (built-in tool; no CLI/API fallback):

> Use case: photorealistic-natural. Create one editorial travel photograph, landscape 3:2 composition, of a quiet Japanese garden in Kyoto: a stone path beside a small still pond, a few red autumn maple branches, moss, simple timber pavilion in the distance. Soft overcast daylight, natural photographic texture, restrained realistic colors, no people, no text, no logos, no UI, no frame. This is illustrative user content embedded in a travel research note in a productivity app, not a marketing hero. Produce one image only.

The original generated image was copied into this bundle unmodified. Personal file bytes are not ingested by the prototype: drop/paste gestures use these fixtures to demonstrate interactions.
