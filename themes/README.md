# Enhanced Catppuccin Themes

Catppuccin themes for pi-coding-agent: pending tools use the main `base` background; success and error stay visually distinct.

Sourced from [ramean](https://github.com/wayanary/ramean) (`themes/catppuccin-*-enhanced.json`). Derived from [`@sherif-fanous/pi-catppuccin`](https://github.com/sherif-fanous/pi-catppuccin) (v0.2.0).

## Themes

| Theme | Flavor | Type |
|-------|--------|------|
| `catppuccin-mocha-enhanced` | Mocha | Dark |
| `catppuccin-macchiato-enhanced` | Macchiato | Dark |
| `catppuccin-frappe-enhanced` | Frappe | Dark |
| `catppuccin-latte-enhanced` | Latte | Light |

## Select in pi

```json
"theme": "catppuccin-macchiato-enhanced"
```

## Tool call backgrounds

| State | Token | Notes |
|-------|-------|-------|
| Pending | `base` | Blends with main surface |
| Success | `mantle` | Neutral |
| Error | red tint | Per-flavor hex in each file |
