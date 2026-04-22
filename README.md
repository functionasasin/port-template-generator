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
node port-template.js pro 7    # 7-court Pro → 1x 24-port switch (max for 24-port)
node port-template.js pro 8    # 8-court Pro → 1x 48-port switch
node port-template.js pro 15   # 15-court Pro → 1x 48-port switch (max for 48-port)
node port-template.js pro 16   # 16-court Pro → 2x 48-port switches

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

3 ports are always reserved at the end of each switch (2 for expansion, 1 for troubleshooting). Switch sizing accounts for this buffer — usable capacity is switch size minus 3.

| Total Device Ports | Configuration       | Vacant Ports |
|--------------------|---------------------|--------------|
| ≤ 21               | 1x 24-port switch   | 3            |
| ≤ 45               | 1x 48-port switch   | 3            |
| > 45               | 2x 48-port switches | 3 per switch |

Vacant ports are shown in the PDF as light grey **VACANT** labeled boxes.

The `templates/` folder is created automatically if it doesn't exist.
