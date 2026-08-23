# Session Notes: TOML парсинг + XML round-trip (Phase 2)

## Key debugging insights

### 1. TOML nested table parent resolution bug

**Symptom:** Parsing `[server]\nhost = "x"\n[server.ssl]\nenabled = true` returned `{}` instead of `{ server: { host: "x", ssl: { enabled: true } } }`.

**Root cause:** `getTomlParent(tables[currentPath], currentPath)` was called with the *new empty table* `{}` as the starting node. Since the new table is empty, there are no keys to traverse, so the parent lookup returned `{}` and the key was set on a throwaway object.

**Fix:** `getTomlParent(root, currentPath)` — always start from `root`, not from the freshly-created table.

**Lesson:** When linking a new nested structure into an existing tree, resolve the parent path from the tree root, not from the node being inserted.

### 2. XML round-trip fails due to formatting

**Symptom:** `run('json', 'xml', json)` produced multi-line indented XML, but the round-trip test expected single-line XML matching the original.

**Root cause:** `XMLBuilder` defaults to `format: true`, which adds whitespace/indentation.

**Fix:** Set `format: false` on the `XMLBuilder` config.

### 3. Converter ID parsing for server fallback

Converter IDs follow the pattern `from-to-to` (e.g., `toml-to-json`). Splitting on `-to-` gives `[from, to]`. This works because no format ID contains `-to-`.
