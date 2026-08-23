# i18n Conventions

## Locale Files

- `i18n/locales/en.json` — English (primary)
- `i18n/locales/ru.json` — Russian (parallel structure)

Both files must have identical key structure. New keys are added in the same relative position.

## Key Patterns

### Converter entries (`conv.*`)

One entry per converter ID, under the `conv` namespace:

```json
"json-to-toml": {
  "from": "JSON",
  "to": "TOML",
  "description": "Parse JSON and write TOML"
}
```

- `from`/`to`: display name of the source/target format
- `description`: human-readable summary, shown in the studio select

### Group labels (`groups.*`)

```json
"data": { "label": "Data formats" }
```

### Categories (`cats.*`)

```json
"text": { "title": "Text", "description": "Text-based formats" }
```

### Error keys (`errors.*`)

Errors are thrown as keys from the parse/serialize functions:

```typescript
throw new Error('errors.badToml')  // not a message, a key
```

The component does `t(message)` to localize. Every parse function should throw `errors.bad<Format>` on failure.

### Format names (`formatNames.*`)

```json
"toml": "TOML"
```

Add when the format name isn't a standard acronym.

## Adding New Strings

1. Add in **both** `en.json` and `ru.json` simultaneously.
2. Match the indentation style (2 spaces).
3. Place new converter entries adjacent to related ones (e.g., TOML entries near YAML entries).
4. Error keys go in the `errors` object, alphabetically ordered by format.
