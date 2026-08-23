# Server API Contract

## GET /api/formats

Returns all registered server converters.

**Response:**
```json
{
  "converters": [
    {
      "id": "json-to-toml",
      "from": "json",
      "to": "toml",
      "tier": "b",
      "inputKind": "text",
      "mime": "application/json"
    },
    ...
  ]
}
```

- `tier`: `"b"` = text (IR-based), `"c"` = binary (image/audio)
- `inputKind`: `"text"` or `"binary"` — determines client-side routing

## POST /api/convert

Performs a server-side conversion.

**Request body:**
```json
{
  "from": "json",
  "to": "toml",
  "text": "{\"key\": \"value\"}"
}
```

For binary formats, `text` field is replaced by a file in multipart form data.

**Response:**
```json
{
  "output": "key = \"value\"\n",
  "mime": "text/plain"
}
```

**Errors:** HTTP 400 with `{ "message": "errors.badJson" }` or similar localized error key.
