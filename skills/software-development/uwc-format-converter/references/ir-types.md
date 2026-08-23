# IrNode Type & makeIrPair Semantics

## IrNode

`IrNode` is the universal intermediate representation — a normalized JSON-like value:

```typescript
type IrScalar = string | number | boolean | null | Date
type IrNode = IrScalar | IrNode[] | { [key: string]: IrNode }
```

- `null` is valid (TOML serializes as `""`; INI/JSON preserve `null`).
- `Date` objects should be serialized as ISO strings by format serializers.
- Arrays may contain mixed types but most formats (CSV, TOML) expect homogeneous arrays.
- Plain objects only — no class instances. Use `isPlainObject()` from `ir.ts` to check.

## IrFormat Interface

```typescript
export interface IrFormat {
  id: string
  parse: (input: string) => IrNode
  serialize: (node: IrNode) => string
}
```

## makeIrPair

`makeIrPair(from: IrFormat, to: IrFormat)` generates a `TextConverter` that:
1. Calls `from.parse(input)` → IrNode
2. Calls `to.serialize(irNode)` → output string

This is the `reverseId` pairing: `makeIrPair(A, B)` and `makeIrPair(B, A)` produce complementary converter IDs like `toml-to-json` and `json-to-toml`.
