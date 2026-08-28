# Port Template Generator

Generates a print-ready PDF port-assignment template for a venue.

> **Sizing comes from the venue calculator.** `planKisi` and `planSwitches` in
> `port-template.js` are transcribed from
> [`kosmas-venue-calculator`](https://github.com/functionasasin/kosmas-venue-calculator)
> (`src/calculator/kisi.ts`, `src/calculator/network.ts`), which is the authority.
> If the two ever disagree, the calculator is right and this file is stale — it
> holds a second copy of those rules, so changes there need porting here.

## Requirements

- Node.js 18+
- Playwright browsers

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
node port-template.js <tier> <courts> --subnet N [--cams N] [--doors N] [--no-backup-internet]
```

**Tiers:** `pro`, `auto`, `autonomous`, `autonomous+` (`autonomous` and
`autonomous+` produce identical templates). `--doors` is required for auto plans.

### `--subnet` is required

`N` is the third octet of the **REPLAY** network. There is deliberately no
default: a sheet labelled with the wrong subnet is the failure this flag exists
to prevent.

| | management | surveillance | REPLAY | access control |
|---|---|---|---|---|
| `--subnet 32` (guide-canonical) | `.30` | `.31` | `.32` | `.33` |
| `--subnet 132` (Kosmas lab) | `.130` | `.131` | `.132` | `.133` |

Surveillance (`N-1`) and access control (`N+1`) are **derived**, so the three
cannot drift apart. Management never appears on a port template — nothing on the
sheet is a management device. Use `.32` for venues configured on-site; `.132` is
the lab-office workaround for an upstream that already occupies `192.168.32.0/20`.

### Examples

```bash
node port-template.js pro 4 --subnet 32
node port-template.js pro 8 --subnet 132
node port-template.js pro 8 --subnet 32 --cams 4
node port-template.js auto 8 --subnet 32 --doors 3
```

**Output:** `templates/port-template-<tier>-<N>court[-<D>doors][-<C>cams]-net<S>.pdf`

The subnet is in the filename so two venues on different subnets don't overwrite
each other. `templates/` is created automatically and is gitignored.

### `--no-backup-internet`

A backup WAN consumes a UDM RJ45 port, which can push a Kisi reader onto the
switch. The UDM drawing has always shown one, so it is assumed present; pass this
flag for a venue without one.

## Port accounting

`3 x courts` (iPad + replay camera + Apple TV) `+ security cameras + Kisi readers
that overflow to the switch`.

The Mac mini is on the UDM, not the switch, so it is not counted. Kisi readers
take UDM-SE PoE ports first (after the Mac mini, one controller per four doors,
and any backup WAN) and only the remainder land on the switch — a deliberate
Kosmas deviation from PodPlay's convention of putting every reader on the switch.

## Switch sizing

Bands are the calculator's:

| Total ports | Configuration | Drawable |
|-------------|---------------------|---|
| 1 court | no switch (gateway powers the court) | — |
| ≤ 24 | 1x 24-port | ✅ |
| ≤ 48 | 1x 48-port | ✅ |
| ≤ 72 | 1x 24-port + 1x 48-port | ❌ |
| ≤ 96 | 2x 48-port | ✅ |
| ≤ 240 | 3-6 switches | ❌ |

The drawing renders one switch, or two of the **same** size. Venues that size to
a mixed pair or to three or more switches exit with an explanation — the sizing
is still correct, this tool just cannot draw it. Size those in the calculator.
