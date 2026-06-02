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
node port-template.js <tier> <courts> [--cams N] [--doors N]
```

**Tiers:** `pro`, `auto`, `autonomous`, `autonomous+`

---

### Pro Plan

```bash
node port-template.js pro 4    # 4-court Pro → 1x 24-port switch
node port-template.js pro 8    # 8-court Pro → 1x 24-port switch
node port-template.js pro 12   # 12-court Pro → 1x 48-port switch
node port-template.js pro 18   # 18-court Pro → 2x 48-port switches

# With optional security cameras (UniFi Cam)
node port-template.js pro 8 --cams 4
```

**Output:** `templates/port-template-pro-<N>court.pdf`

---

### Auto Plan (Autonomous / Autonomous+)

Includes all Pro devices plus Kisi access control (1 Controller + 1 Reader per door). `autonomous` and `autonomous+` produce identical templates.

```bash
node port-template.js auto 8 --doors 3
node port-template.js autonomous 8 --doors 3
node port-template.js autonomous+ 8 --doors 3

# With optional security cameras
node port-template.js auto 8 --doors 3 --cams 2
```

`--doors` is required for auto plans.

**Output:** `templates/port-template-auto-<N>court-<D>doors.pdf`

---

### Switch Sizing

Switch sizing is based on total port slots required across all device types.

| Total Ports | Configuration       |
|-------------|---------------------|
| ≤ 24        | 1x 24-port switch   |
| ≤ 48        | 1x 48-port switch   |
| > 48        | 2x 48-port switches |

The `templates/` folder is created automatically if it doesn't exist.
