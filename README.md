# Port Template Generator

Generates print-ready PDF port assignment templates for PodPlay court installations based on tier and court count.

## Requirements

- Node.js 18+
- Playwright browsers

```bash
npm install
npx playwright install chromium
```

## Scripts

### port-template.js

Generates a print-ready PDF port assignment template for a given tier and court count.

```bash
node port-template.js <tier> <courts>

node port-template.js pro 4    # 4-court Pro → 1x 24-port switch
node port-template.js pro 8    # 8-court Pro → 1x 24-port switch
node port-template.js pro 12   # 12-court Pro → 1x 48-port switch
node port-template.js pro 18   # 18-court Pro → 2x 48-port switches
```

**Output**
- `templates/port-template-pro-<N>court.pdf` — print this
- `templates/html/port-template-pro-<N>court.html` — HTML source

The `templates/` and `templates/html/` folders are created automatically if they don't exist.

**Switch sizing (Pro)**

| Courts  | Switches              |
|---------|-----------------------|
| 1–8     | 1x 24-port switch     |
| 9–16    | 1x 48-port switch     |
| 17–18   | 2x 48-port switches   |

