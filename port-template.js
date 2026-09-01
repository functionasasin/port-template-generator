import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

// ─── Config ───────────────────────────────────────────────────────────────────

// Ported verbatim from the venue calculator (functionasasin/kosmas-venue-calculator,
// src/calculator/network.ts + kisi.ts), which is the authority on sizing. Kept as
// a literal transcription rather than a tidied rewrite so the two can be diffed.
// [maxPorts, count24, count48]
const BANDS = [
  [24, 1, 0], [48, 0, 1], [72, 1, 1], [96, 0, 2], [120, 1, 2],
  [144, 0, 3], [168, 1, 3], [192, 0, 4], [216, 1, 4], [240, 0, 5],
  [264, 1, 5],
];

/**
 * podplay-ph-venue-sizing.md § IP addressing, committed 2026-09-01 as 52da35f
 * in this repo. That document is the authority; this is a transcription of it,
 * the same one src/pdf/portPlan.ts carries in the calculator.
 *
 * The old 10-wide REPLAY blocks (.20/.30/.40 + N) only hold to 8 courts. At 11
 * courts iPad C11 and replay camera C1 are both .31; at 14 courts EIGHT
 * addresses are duplicated. Every sheet this tool produced above 10 courts was
 * wrong. Venues of 9+ courts use the wide blocks; the iPad block is
 * deliberately unchanged, so only two of the three move.
 *
 * Surveillance and access control DERIVE as N-1 and N+1 of REPLAY. Writing all
 * three as literals is how they drift apart — which already happened once here,
 * when hardcoded .33/.34 got out of step with a .132 REPLAY legend.
 */
const WIDE_FROM = 9;

function ipFor(kind, n, courts, subnet) {
  const replay = `192.168.${subnet}`;
  const surveillance = `192.168.${subnet - 1}`;
  const access = `192.168.${subnet + 1}`;
  const wide = courts >= WIDE_FROM;
  switch (kind) {
    case 'ipad':       return `${replay}.${20 + n}`;
    case 'replay':     return `${replay}.${(wide ? 120 : 30) + n}`;
    case 'appletv':    return `${replay}.${(wide ? 160 : 40) + n}`;
    case 'macmini':    return `${replay}.100`;
    case 'security':   return `${surveillance}.${20 + n}`;
    case 'controller': return `${access}.${10 + n}`;
    case 'reader':     return `${access}.${20 + n}`;
    default: throw new Error(`unknown address kind: ${kind}`);
  }
}

/** Boxes carry the host octet only; the legend carries the network. */
const shortIp = ip => `.${ip.split('.')[3]}`;

/**
 * The camera block runs upward from .21 and the NVR holds .100, so the plan is
 * defined to 79 cameras.
 */
const MAX_SECURITY_CAMERAS = 79;

/**
 * The wide blocks are 40 apart (replay .120+N, Apple TV .160+N), so they hold
 * to 40 courts — at 41 replay C41 and Apple TV C1 are both .161, which is the
 * §3a collision all over again one block up. The doc's table stops at 32
 * courts, and the two-switch limit below happens to stop there too (96 ports
 * / 3 per court). This bound is stated rather than left to that coincidence:
 * if the render limit ever moves, the addressing must be extended first.
 */
const MAX_COURTS_ADDRESSED = 32;

const UDM_RJ45_PORTS = 8;
const MAC_MINI_PORTS = 1;
const DOORS_PER_CONTROLLER = 4;

/**
 * calculator kisi.ts: one controller per four doors; readers take UDM-SE PoE
 * ports first and overflow to the switch. Supersedes this tool's older
 * "controller + reader #1 on the UDM, rest on the switch" rule, which spec'd a
 * 48-port switch where the calculator specs a 24.
 */
function planKisi(doors, backupInternet) {
  const readers = doors;
  const controllers = Math.ceil(readers / DOORS_PER_CONTROLLER);
  const freeUdmPorts = Math.max(
    0,
    UDM_RJ45_PORTS - MAC_MINI_PORTS - controllers - (backupInternet ? 1 : 0),
  );
  const readersOnUdm = Math.min(readers, freeUdmPorts);
  return { controllers, readers, readersOnUdm, readersOnSwitch: readers - readersOnUdm };
}

/**
 * Two switches of any sizes, since the fill is sequential and no longer keys
 * off a per-switch group list. This used to refuse the calculator's 49-72 band
 * (1x24 + 1x48) outright — a real venue shape, and the one the calculator
 * draws. Three or more switches is still a layout limit of this tool, not a
 * disagreement about sizing: the numbers are the calculator's either way.
 */
function planIsRenderable(plan) {
  return plan.count24 + plan.count48 <= 2;
}

/** calculator network.ts: banded, and a 1-court venue gets no switch at all. */
function planSwitches(courts, ports) {
  if (courts === 1) return { count24: 0, count48: 0, overCapacity: false };
  const band = BANDS.find(([max]) => ports <= max);
  if (!band) return { count24: 0, count48: 0, overCapacity: true };
  return { count24: band[1], count48: band[2], overCapacity: false };
}

// ─── Port assignment builders ─────────────────────────────────────────────────

/**
 * Renders the counts planKisi returns. This used to hardcode ONE controller on
 * port 2 and ONE reader on port 4 for every Autonomous venue whatever its door
 * count — an 8-court venue with 6 doors and backup internet actually has 2
 * controllers and 4 readers on the UDM, and the sheet showed two boxes.
 *
 * Slot 1 is the Mac mini, then controllers, then the readers that fit, with the
 * backup WAN on slot 8. planKisi's own arithmetic subtracts the Mac mini, the
 * controllers and the backup WAN, so the readers it says fit do fit; main()
 * checks the total separately because `controllers` is uncapped.
 */
function buildUDMPorts(kisi, courts, subnet, backupInternet) {
  // Physical UDM-SE layout: 8 LAN ports in 2 rows, then WAN + SFP
  // Top row: ports 1, 3, 5, 7, [gap], 10
  // Bottom row: ports 2, 4, 6, 8, [gap], 9, 11(SFP)
  const small = t => `<span style="font-size:6.5px;">${t}</span>`;
  const assign = {
    1: `Mac Mini\n${small(shortIp(ipFor('macmini', 1, courts, subnet)))}`,
    9: 'Main Internet',
    11: 'SFP Cable\nTo Switch 1',
  };
  const colors = {};

  let slot = 2;
  for (let n = 1; n <= (kisi.controllers || 0); n++) {
    // The sources scope the ACCESS CONTROL VLAN instruction to readers, so the
    // controller carries its address but no VLAN tag.
    assign[slot] = `Kisi Ctrl\n#${n}\n${small(shortIp(ipFor('controller', n, courts, subnet)))}`;
    colors[slot] = COLORS.kisi;
    slot++;
  }
  for (let n = 1; n <= (kisi.readersOnUdm || 0); n++) {
    assign[slot] = `Kisi Reader\n#${n}\n${small(shortIp(ipFor('reader', n, courts, subnet)))}`;
    colors[slot] = COLORS.kisi;
    slot++;
  }
  if (backupInternet) assign[8] = 'Backup Internet';

  return {
    topPorts:    [1, 3, 5, 7, null, 10],
    bottomPorts: [2, 4, 6, 8, null, 9, 11],
    assign,
    colors,
  };
}

/**
 * Every device the switches must carry, in fixed order. One flat list, filled
 * sequentially and spilling onto the next switch — NOT a per-switch group list.
 *
 * The group form laid out every device it was handed and only afterwards padded
 * up to switchSize, with no capacity check at all: at 25 courts it put 50
 * devices on a 48-port panel, numbered past port 48, and the SFP box (hardcoded
 * at switchSize+1) collided with ports 49 and 50. A group may now split across
 * two switches; every box is labelled, so the sheet stays unambiguous.
 */
function devicesFor(courts, cams, kisi, subnet) {
  const out = [];
  const dev = (label, ip, color) => out.push({ label, ip: shortIp(ip), color });
  for (let n = 1; n <= courts; n++) dev(`iPad\nC${n}`, ipFor('ipad', n, courts, subnet), COLORS.ipad);
  for (let n = 1; n <= courts; n++) dev(`Replay Cam\nC${n}`, ipFor('replay', n, courts, subnet), COLORS.camera);
  for (let n = 1; n <= courts; n++) dev(`Apple TV\nC${n}`, ipFor('appletv', n, courts, subnet), COLORS.appletv);
  for (let n = 1; n <= cams; n++) dev(`UniFi Cam\n#${n}`, ipFor('security', n, courts, subnet), COLORS.securitycam);
  // Readers are numbered across the WHOLE venue: the ones on the UDM took the
  // first readersOnUdm numbers, so these continue rather than restart.
  for (let i = 1; i <= (kisi.readersOnSwitch || 0); i++) {
    const n = kisi.readersOnUdm + i;
    dev(`Kisi Reader\n#${n}`, ipFor('reader', n, courts, subnet), COLORS.kisi);
  }
  return out;
}

/**
 * One switch's columns, consuming from `devices` starting at `from`. Returns
 * the columns and the index the next switch resumes at, so nothing is drawn
 * twice and nothing is dropped.
 *
 * `uplink` differs per switch: a UDM has ONE 10G SFP+ LAN socket (Ubiquiti's
 * tech specs, not any Kosmas document), so switch 2 daisy-chains off switch 1.
 * This used to be hardcoded 'to UDM' and drawn once per switch, showing two
 * DACs into a gateway with one socket for them.
 */
function buildSwitchPorts(devices, from, switchSize, uplink) {
  const columns = [];
  const box = d => `${d.label}\n<span style="font-size:6.5px;">${d.ip}</span>`;
  let i = from;

  for (let portNum = 1; portNum <= switchSize; portNum += 2) {
    const top = devices[i];
    if (top) i++;
    const bottom = devices[i];
    if (bottom) i++;
    columns.push({
      type:         'port',
      topPort:      portNum,
      topDevice:    top ? box(top) : '',
      topColor:     top ? top.color : COLORS.empty,
      bottomPort:   portNum + 1,
      bottomDevice: bottom ? box(bottom) : '',
      bottomColor:  bottom ? bottom.color : COLORS.empty,
    });
  }

  // Beyond the numbered face, so it cannot collide with a port the way the
  // old fixed switchSize+1 slot did once the panel overflowed.
  columns.push({
    type:         'port',
    topPort:      null,
    topDevice:    uplink,
    topColor:     COLORS.sfp,
    bottomPort:   null,
    bottomDevice: '',
    bottomColor:  COLORS.empty,
    gapBefore:    true,
    isSfp:        true,
  });

  return { columns, next: i };
}

// ─── Device colors ────────────────────────────────────────────────────────────

const COLORS = {
  ipad:        '#BDD7EE',
  camera:      '#E2EFDA',
  appletv:     '#FCE4D6',
  securitycam: '#E2D9F3',
  kisi:        '#FFF2CC',
  empty:       '#FFFFFF',
  sfp:         '#D9D9D9',
  udm:         '#D6DCE4',
};

// ─── HTML builders ────────────────────────────────────────────────────────────

function portBox(label, color = COLORS.empty, small = false) {
  const bg = color;
  const fontSize = small ? '7px' : '8px';
  return `<div class="port-box" style="background:${bg};font-size:${fontSize};">${label.replace(/\n/g, '<br>')}</div>`;
}

function portNum(num) {
  if (num === null) return `<div class="port-num-empty"></div>`;
  return `<div class="port-num">Port ${num}</div>`;
}

function buildUDMHtml(kisi, courts, subnet, backupInternet) {
  const { topPorts, bottomPorts, assign, colors } =
    buildUDMPorts(kisi, courts, subnet, backupInternet);

  const topNums  = topPorts.map(p => portNum(p)).join('');
  const topBoxes = topPorts.map(p => {
    if (p === null) return `<div class="port-gap"></div>`;
    const color = colors[p] || (assign[p] ? COLORS.udm : COLORS.empty);
    return portBox(assign[p] || '', color);
  }).join('');

  const botBoxes = bottomPorts.map(p => {
    if (p === null) return `<div class="port-gap"></div>`;
    const isSfp = p === 11;
    const color = isSfp ? COLORS.sfp : (colors[p] || (assign[p] ? COLORS.udm : COLORS.empty));
    return portBox(assign[p] || '', color);
  }).join('');

  const botNums = bottomPorts.map(p => portNum(p)).join('');

  return `
    <div class="panel">
      <div class="panel-title">UDM</div>
      <div class="panel-body">
        <div class="port-row port-nums top">${topNums}</div>
        <div class="port-row boxes top">${topBoxes}</div>
        <div class="port-row boxes bot">${botBoxes}</div>
        <div class="port-row port-nums bot">${botNums}</div>
      </div>
    </div>`;
}

function buildSwitchHtml(title, columns) {
  const gapDiv = `<div class="port-gap"></div>`;
  const sfpLabel = `<div class="port-num">SFP/Uplink</div>`;
  // Per-BOX colour, not per column: the fill is sequential now, so one column
  // can straddle two device kinds (the last iPad above the first replay cam).
  const topNums  = columns.map(col => col.type === 'gap' ? gapDiv : (col.gapBefore ? gapDiv : '') + (col.isSfp ? sfpLabel : portNum(col.topPort))).join('');
  const topBoxes = columns.map(col => col.type === 'gap' ? gapDiv : (col.gapBefore ? gapDiv : '') + portBox(col.topDevice || '', col.topColor)).join('');
  const botBoxes = columns.map(col => col.type === 'gap' ? gapDiv : (col.gapBefore ? gapDiv : '') + portBox(col.bottomDevice || '', col.bottomColor)).join('');
  const botNums  = columns.map(col => col.type === 'gap' ? gapDiv : (col.gapBefore ? gapDiv : '') + (col.isSfp ? `<div class="port-num-empty"></div>` : portNum(col.bottomPort))).join('');

  return `
    <div class="panel wide">
      <div class="panel-title">${title}</div>
      <div class="panel-body">
        <div class="port-row port-nums top">${topNums}</div>
        <div class="port-row boxes top">${topBoxes}</div>
        <div class="port-row boxes bot">${botBoxes}</div>
        <div class="port-row port-nums bot">${botNums}</div>
      </div>
    </div>`;
}

// ─── Full HTML page ───────────────────────────────────────────────────────────

const AUTO_TIERS = ['auto', 'autonomous', 'autonomous+'];

function buildHtml(tier, courts, cams, doors, subnet, backupInternet) {
  // Four consecutive nets, VLAN ID = third octet: management, surveillance,
  // REPLAY, access control (podplay-ph-lab-flow.md step 24). Only REPLAY
  // varies per venue, so the operator passes it and the other two derive —
  // deriving is what stops the three drifting apart, which is how the old
  // hardcoded .33/.34 got out of step with the .132 REPLAY legend.
  const replayNet = `192.168.${subnet}`;
  const surveillanceNet = `192.168.${subnet - 1}`;
  const accessNet = `192.168.${subnet + 1}`;
  const isAuto = AUTO_TIERS.includes(tier.toLowerCase());

  const kisi = isAuto ? planKisi(doors, backupInternet) : { readersOnSwitch: 0 };
  const kisiOnSwitch = kisi.readersOnSwitch;
  const totalPorts = courts * 3 + cams + kisiOnSwitch;
  const plan = planSwitches(courts, totalPorts);
  const udmHtml = buildUDMHtml(kisi, courts, subnet, backupInternet);

  // Larger switch first, filled first, drawn topmost and titled Switch 1 —
  // rack order and fill order are the same order, as in the calculator.
  const sizes = [
    ...Array(plan.count48).fill(48),
    ...Array(plan.count24).fill(24),
  ];
  const devices = devicesFor(courts, cams, kisi, subnet);

  // Titles name the SIZE only. They used to name the contents ("Switch 1
  // (48-port) — iPads + Cameras") and were hardcoded to 48 whatever the plan
  // said; with a sequential fill a group can straddle both switches, so a
  // contents title would be wrong as often as it was right.
  let next = 0;
  const switchPanels = sizes.map((size, i) => {
    const uplink = i === 0 ? 'SFP Cable\nto UDM' : 'SFP Cable\nto Switch 1';
    const built = buildSwitchPorts(devices, next, size, uplink);
    next = built.next;
    return buildSwitchHtml(
      `Switch ${i + 1} (${size}-port)`, built.columns,
    );
  });

  const switchesHtml = `
      <div class="row">
        ${udmHtml}
        ${switchPanels[0] ?? ''}
      </div>${switchPanels.slice(1).map(html => `
      <div class="row" style="margin-top:24px;">
        ${html}
      </div>`).join('')}`;

  const tierLabel = isAuto ? 'Auto' : 'Pro';
  const doorsLabel = isAuto ? ` | ${doors} Doors` : '';
  const camsLabel  = cams > 0 ? ` | ${cams} Security Cams` : '';

  const camLegend = cams > 0 ? `
    <div style="display:flex;align-items:center;gap:5px;">
      <div style="width:14px;height:14px;background:#E2D9F3;border:1px solid #000;flex-shrink:0;"></div>
      <span>UniFi Cam — ${surveillanceNet}.(20+N)</span>
    </div>` : '';

  const kisiLegend = isAuto ? `
    <div style="display:flex;align-items:center;gap:5px;">
      <div style="width:14px;height:14px;background:#FFF2CC;border:1px solid #000;flex-shrink:0;"></div>
      <span>Kisi — ${accessNet}: controllers .(10+N), readers .(20+N)</span>
    </div>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, sans-serif;
    font-size: 9px;
    padding: 20px;
    background: white;
  }
  h1 {
    font-size: 13px;
    margin-bottom: 16px;
    color: #1F3864;
  }
  .row {
    display: flex;
    gap: 20px;
    align-items: flex-start;
    margin-bottom: 4px;
  }
  .panel {
    display: inline-block;
  }
  .panel-title {
    font-size: 10px;
    font-weight: bold;
    margin-bottom: 6px;
  }
  .panel-body {
    border: 2px solid #000;
    padding: 8px;
    display: inline-block;
  }
  .port-row {
    display: flex;
    align-items: stretch;
    gap: 2px;
  }
  .port-row.port-nums {
    min-height: 14px;
  }
  .port-row.boxes {
    min-height: 52px;
  }
  .port-num {
    width: 52px;
    text-align: center;
    font-size: 7.5px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .port-num-empty {
    width: 52px;
  }
  .port-box {
    width: 52px;
    border: 1px solid #000;
    display: flex;
    align-items: flex-end;
    justify-content: flex-start;
    padding: 2px 3px;
    font-size: 8px;
    line-height: 1.2;
    min-height: 52px;
  }
  .port-gap {
    width: 12px;
  }
</style>
</head>
<body>
  <h1>Port Template — ${tierLabel} | ${courts} Courts${doorsLabel}${camsLabel}</h1>
  <div style="display:flex;gap:20px;align-items:center;margin-bottom:12px;font-size:8px;flex-wrap:wrap;">
    <div style="display:flex;align-items:center;gap:5px;">
      <div style="width:14px;height:14px;background:#BDD7EE;border:1px solid #000;flex-shrink:0;"></div>
      <span>iPad — ${replayNet}.(20+N)</span>
    </div>
    <div style="display:flex;align-items:center;gap:5px;">
      <div style="width:14px;height:14px;background:#E2EFDA;border:1px solid #000;flex-shrink:0;"></div>
      <span>Replay Camera — ${replayNet}.(${courts >= WIDE_FROM ? 120 : 30}+N)</span>
    </div>
    <div style="display:flex;align-items:center;gap:5px;">
      <div style="width:14px;height:14px;background:#FCE4D6;border:1px solid #000;flex-shrink:0;"></div>
      <span>Apple TV — ${replayNet}.(${courts >= WIDE_FROM ? 160 : 40}+N)</span>
    </div>
    <div style="display:flex;align-items:center;gap:5px;">
      <div style="width:14px;height:14px;background:#D6DCE4;border:1px solid #000;flex-shrink:0;"></div>
      <span>Mac Mini — ${replayNet}.100</span>
    </div>
    ${camLegend}
    ${kisiLegend}
    <span style="color:#555;">N = court/device number</span>
  </div>
  ${courts >= WIDE_FROM ? `<div style="font-size:8px;color:#555;margin-bottom:12px;">
    Replay camera and Apple TV addresses use the 9+ court plan. A venue previously
    configured at 8 courts or fewer must be re-addressed. Verify before labelling.
  </div>` : ''}
  ${switchesHtml}
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const [tierArg, courtsArg] = args;

  if (!tierArg || !courtsArg) {
    console.error('Usage: node port-template.js <tier> <courts> --subnet N [--cams N] [--doors N]');
    console.error('  Tiers: pro, auto, autonomous, autonomous+');
    console.error('  --subnet N             REPLAY third octet (32 = guide-canonical, 132 = lab)');
    console.error('  --no-backup-internet   venue has no backup WAN (frees a UDM port for Kisi)');
    console.error('Example: node port-template.js pro 4 --subnet 32');
    console.error('Example: node port-template.js pro 8 --subnet 132 --cams 4');
    console.error('Example: node port-template.js auto 8 --subnet 32 --doors 3');
    process.exit(1);
  }

  const tier = tierArg.toLowerCase();
  const isAuto = AUTO_TIERS.includes(tier);
  const validTiers = ['pro', ...AUTO_TIERS];
  if (!validTiers.includes(tier)) {
    console.error(`Invalid tier "${tierArg}". Valid tiers: pro, auto, autonomous, autonomous+`);
    process.exit(1);
  }

  const courts = parseInt(courtsArg);
  // Upper bound is the largest sizing band (240 ports / 3 per court). What this
  // tool can actually draw is narrower, and the plan checks below say so.
  if (isNaN(courts) || courts < 1 || courts > 80) {
    console.error('Court count must be between 1 and 80.');
    process.exit(1);
  }

  const subnetIdx = args.indexOf('--subnet');
  if (subnetIdx === -1) {
    console.error('--subnet N is required — N is the REPLAY third octet (e.g. 32 guide-canonical, 132 lab).');
    console.error('There is deliberately no default: a sheet labelled with the wrong subnet is the failure this flag exists to prevent.');
    process.exit(1);
  }
  const subnet = parseInt(args[subnetIdx + 1]);
  if (isNaN(subnet) || subnet < 1 || subnet > 254) {
    console.error('--subnet must be an integer between 1 and 254.');
    process.exit(1);
  }

  // calculator VenueInputs.backupInternet — consumes a UDM RJ45 port, so it can
  // push a Kisi reader onto the switch. The UDM drawing has always shown a
  // backup WAN, so that stays the default.
  const backupInternet = !args.includes('--no-backup-internet');

  const camsIdx = args.indexOf('--cams');
  let cams = 0;
  if (camsIdx !== -1) {
    cams = parseInt(args[camsIdx + 1]);
    if (isNaN(cams) || cams < 0) {
      console.error('--cams must be a non-negative integer.');
      process.exit(1);
    }
  }

  const doorsIdx = args.indexOf('--doors');
  let doors = 0;
  if (isAuto) {
    if (doorsIdx === -1) {
      console.error('--doors N is required for auto/autonomous plans.');
      process.exit(1);
    }
    doors = parseInt(args[doorsIdx + 1]);
    if (isNaN(doors) || doors < 1) {
      console.error('--doors must be a positive integer.');
      process.exit(1);
    }
  }

  const kisiPlan = isAuto ? planKisi(doors, backupInternet) : { readersOnSwitch: 0 };
  const ports = courts * 3 + cams + kisiPlan.readersOnSwitch;
  const plan = planSwitches(courts, ports);

  if (courts === 1) {
    console.error('A 1-court venue gets no switch — the gateway powers the court directly,');
    console.error('so there is no switch to make a port template for.');
    process.exit(1);
  }
  if (plan.overCapacity) {
    console.error(`${ports} ports exceeds the largest sizing band (240). Size this in the venue calculator.`);
    process.exit(1);
  }
  if (courts > MAX_COURTS_ADDRESSED) {
    console.error(`The addressing plan is defined to ${MAX_COURTS_ADDRESSED} courts; above that the`);
    console.error('replay and Apple TV blocks collide. Extend podplay-ph-venue-sizing.md first.');
    process.exit(1);
  }
  // controllers = ceil(doors/4) is uncapped, so the UDM's 8 RJ45 ports can be
  // oversubscribed before any of the switch checks fire. Drawing a 9th box on
  // an 8-port device is the failure this prevents.
  const udmDemand = 1 + (kisiPlan.controllers || 0) + (kisiPlan.readersOnUdm || 0)
    + (backupInternet ? 1 : 0);
  if (udmDemand > UDM_RJ45_PORTS) {
    console.error(`This venue needs ${udmDemand} UDM ports and the UDM has ${UDM_RJ45_PORTS}.`);
    console.error('The sizing is correct — the template cannot draw it. Use the venue calculator.');
    process.exit(1);
  }
  if (cams > MAX_SECURITY_CAMERAS) {
    console.error(`${cams} security cameras exceeds the addressing plan, whose camera block`);
    console.error(`ends below the NVR reservation at .100. The plan is defined to ${MAX_SECURITY_CAMERAS}.`);
    process.exit(1);
  }
  if (!planIsRenderable(plan)) {
    console.error(`This venue sizes to ${plan.count24}x 24-port + ${plan.count48}x 48-port (${ports} ports).`);
    console.error('This tool can only draw one or two switches.');
    console.error('The sizing is correct — the template just cannot render it. Use the venue calculator.');
    process.exit(1);
  }

  const html = buildHtml(tier, courts, cams, doors, subnet, backupInternet);
  const tierSlug = isAuto ? 'auto' : 'pro';
  const camsSuffix  = cams > 0  ? `-${cams}cams`   : '';
  const doorsSuffix = doors > 0 ? `-${doors}doors`  : '';
  // Every input that changes the drawing is in the name — otherwise two runs of
  // the same venue silently overwrite each other.
  const backupSuffix = backupInternet ? '' : '-nobackup';
  const pdfFile = `templates/port-template-${tierSlug}-${courts}court${doorsSuffix}${camsSuffix}-net${subnet}${backupSuffix}.pdf`;

  mkdirSync('templates', { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: pdfFile,
    format: 'A3',
    landscape: true,
    printBackground: true,
    margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
  });
  await browser.close();

  console.log(`✓ Generated templates/${pdfFile.split('/').pop()} — REPLAY 192.168.${subnet}.0/24`);
}

main();
