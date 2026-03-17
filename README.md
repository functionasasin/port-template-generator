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

The `templates/` folder is created automatically if it doesn't exist.

**Switch sizing (Pro)**

| Courts  | Switches              |
|---------|-----------------------|
| 1–8     | 1x 24-port switch     |
| 9–16    | 1x 48-port switch     |
| 17–18   | 2x 48-port switches   |

