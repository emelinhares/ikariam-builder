# NORMALIZATION_RULES

Normalization rules validated from scrape evidence and approved for typed ERP state promotion.

## Scope constraints

- Keep distinction between `model`, `html`, and `calculated` origins.
- Do not invent missing values.
- Prefer deterministic transforms only.

## Canonical parsing rules

| Raw sample | Normalized field(s) | Rule |
|---|---|---|
| `Net Gold: 834` | `netGoldPerHour` | Strip label and parse signed integer |
| `Growth: 15.10 per Hour` | `populationGrowthPerHour` | Strip label/unit and parse signed decimal |
| `Housing space: 378/1,370` | `populationUsed`, `maxInhabitants`, `populationUtilization` | Parse both sides, remove thousand separators, derive ratio `used / max` |
| `0%` | `corruptionPct` | Remove `%`, parse integer |
| `euphoric|happy|neutral|unhappy` | `happinessState` | Trim and uppercase enum string |
| `+196|+25|+152|+758|+0|-120` | `bonus_or_delta_numeric` | Keep sign, parse signed integer |
| `47,533` | `buyTransporterCostGold` | Remove thousand separators and parse integer |
| `34m 30s` | `etaDuration` | Optional parse to seconds (`34*60 + 30`) |

## Numeric parsing policy

1. Remove locale thousand separators (`,`, `.`, spaces) only where the field contract indicates grouped integer formatting.
2. Preserve explicit sign for deltas and costs that can be negative.
3. For decimal values (e.g., growth/hour), parse with dot decimal and keep numeric precision.
4. If parsing fails, keep field undefined and preserve source metadata as non-promoted.

## Derived field policy

- `populationUtilization` is always derived from normalized numeric parents.
- Parent safety rule: derive only when `maxInhabitants > 0`.
- Division by zero or missing parent values must produce `null` (not fabricated values).

