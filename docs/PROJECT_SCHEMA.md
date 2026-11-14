# NEXORA project format (`.nexora`, schema v2)

```jsonc
{
  "nexora": { "schema": 2, "app": "NEXORA Studio", "saved": "2026-11-05T21:00:00Z" },
  "edit":   { "fusion": 1, "project": { /* Edit timeline: w,h,fps,dur,layers[] */ }, "media": { "<id>": { "name", "kind", "w", "h", "dur", "link"?, "data": "data:…" | null } } },
  "images": { "<docId>": { "format": "nexora-image", "version": 1, "w", "h", "rev", "layers": [ /* tree; pixel layers carry "png", masks carry "mask.png" */ ] } },
  "assets": { "open": ["<docId>"], "active": "<docId>", "workspace": "image" }
}
```

- **Links:** a media record with `"link": { "doc": "<docId>", "rev": n }` is rendered from that Image document. On load, docs are restored first, then links re-flatten (so a project stays correct even if `data` is missing).
- **Migration:** v1 (`{ "fusion": 1, … }`, Fusion Studio) is migrated in memory to v2 on open. Files from a newer schema are refused with a clear message.
- **Validation:** `Schema.validate()` reports missing media references (including inside precomps), links to missing image docs, wrong image format tags and invalid sizes. Problems are shown as warnings on open.
- **Recovery:** the same envelope is autosaved to IndexedDB (`nexora-recovery`) 4 s after changes; media above 150 MB total is stored without bytes (`data: null`) and must be relinked.
- **Standalone image docs:** `.nxi` = one `images[...]` entry on its own.
