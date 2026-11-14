# NEXORA brush file format (`.nxbrush`, JSON)

A file holds one brush, or a set.

```json
{
  "format": "nexora-brush",
  "version": 1,
  "name": "Dry Chalk",
  "size": 40, "hardness": 70, "opacity": 100, "flow": 80,
  "spacing": 14, "angle": 0, "roundness": 100,
  "scatter": 4, "sizeJitter": 0, "smoothing": 20,
  "texture": "paper", "textureScale": 100,
  "pressureSize": true, "pressureOpacity": false,
  "tip": null
}
```

| Field | Range | Meaning |
|---|---|---|
| size | 1–1000 px | Diameter |
| hardness | 0–100 | Solid core radius of round tips |
| opacity | 1–100 | Maximum coverage of one stroke |
| flow | 1–100 | Coverage per dab (builds up to `opacity`) |
| spacing | 1–200 % of size | Distance between dabs |
| angle / roundness | −180–180° / 5–100 % | Tip rotation and squash |
| scatter / sizeJitter | % | Random dab offset / size variation |
| texture | `none` `noise` `canvas` `paper` `stipple` | Grain multiplied into each dab, anchored to the canvas |
| tip | `null` or `data:image/png;base64,…` | Custom tip: alpha channel = paint coverage |

Set file: `{ "format": "nexora-brush-set", "version": 1, "brushes": [ …brush objects… ] }`.

Unknown fields are ignored; a `version` newer than 1 is rejected. Tips must be `data:image/…` URLs (no remote URLs). In the app: Brush settings › Import brush / Export brush, or "Tip from image…" (dark pixels become paint).
