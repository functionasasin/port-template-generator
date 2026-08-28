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
];

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
 * The drawing calls buildSwitchPorts once per switch with a single size, so it
 * can render one switch, or two of the SAME size — nothing else. That leaves
 * the calculator's 49-72 band (1x24 + 1x48) and everything above 96 ports
 * undrawable. This is a layout limit of this tool, not a disagreement about
 * sizing: the numbers are the calculator's either way.
 */
function planIsRenderable(plan) {
  const total = plan.count24 + plan.count48;
  return total === 1 || (total === 2 && plan.count24 === 0);
}

/** calculator network.ts: banded, and a 1-court venue gets no switch at all. */
function planSwitches(courts, ports) {
  if (courts === 1) return { count24: 0, count48: 0, overCapacity: false };
  const band = BANDS.find(([max]) => ports <= max);
  if (!band) return { count24: 0, count48: 0, overCapacity: true };
  return { count24: band[1], count48: band[2], overCapacity: false };
}

// ─── Port assignment builders ─────────────────────────────────────────────────

function buildUDMPorts(isAuto) {
  // Physical UDM-SE layout: 8 LAN ports in 2 rows, then WAN + SFP
  // Top row: ports 1, 3, 5, 7, [gap], 10
  // Bottom row: ports 2, 4, 6, 8, [gap], 9, 11(SFP)
  const assign = {
    1: 'Mac Mini\n<span style="font-size:6.5px;">.100</span>',
    8: 'Backup Internet',
    9: 'Main Internet',
    11: 'SFP Cable\nTo Switch',
  };
  const colors = {};
  if (isAuto) {
    assign[2] = 'Kisi\nController';
    assign[4] = 'Kisi\nReader';
    colors[2] = COLORS.kisi;
    colors[4] = COLORS.kisi;
  }
  return {
    topPorts:    [1, 3, 5, 7, null, 10],
    bottomPorts: [2, 4, 6, 8, null, 9, 11],
    assign,
    colors,
  };
}

function buildSwitchPorts(groups, switchSize) {
  // groups: [{ label, prefix, courts }]
  // Returns array of port-pair columns; gaps are empty numbered port pairs; SFP is a fixed port at switchSize+1
  const columns = [];
  let portNum = 1;

  groups.forEach((group, gi) => {
    const pairs = Math.ceil(group.courts / 2);
    for (let p = 0; p < pairs; p++) {
      const c1 = p * 2 + 1;
      const c2 = p * 2 + 2;
      const labelFn = group.nameFn
        ? (n) => `${group.nameFn(n)}\n<span style="font-size:6.5px;">${group.ipFn(n)}</span>`
        : (n) => `${group.prefix}\nC${n}\n<span style="font-size:6.5px;">${group.ipFn(n)}</span>`;
      columns.push({
        type: 'port',
        topPort:      portNum,
        topDevice:    labelFn(c1),
        bottomPort:   portNum + 1,
        bottomDevice: c2 <= group.courts ? labelFn(c2) : '',
        color:        group.color,
      });
      portNum += 2;
    }
  });

  // Fill remaining empty ports up to switchSize
  while (portNum <= switchSize) {
    columns.push({
      type:         'port',
      topPort:      portNum,
      topDevice:    '',
      bottomPort:   portNum + 1,
      bottomDevice: '',
      color:        COLORS.empty,
    });
    portNum += 2;
  }

  // SFP at fixed port number (switchSize + 1, e.g. port 25 on a 24-port switch)
  const sfpPort = switchSize + 1;
  columns.push({
    type:         'port',
    topPort:      sfpPort,
    topDevice:    'SFP Cable\nto UDM',
    bottomPort:   sfpPort + 1,
    bottomDevice: '',
    color:        COLORS.sfp,
    gapBefore:    true,
    isSfp:        true,
  });

  return columns;
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

function buildUDMHtml(isAuto) {
  const { topPorts, bottomPorts, assign, colors } = buildUDMPorts(isAuto);

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
  const topNums  = columns.map(col => col.type === 'gap' ? gapDiv : (col.gapBefore ? gapDiv : '') + (col.isSfp ? sfpLabel : portNum(col.topPort))).join('');
  const topBoxes = columns.map(col => col.type === 'gap' ? gapDiv : (col.gapBefore ? gapDiv : '') + portBox(col.topDevice || '', col.color)).join('');
  const botBoxes = columns.map(col => col.type === 'gap' ? gapDiv : (col.gapBefore ? gapDiv : '') + portBox(col.bottomDevice || '', col.bottomDevice ? col.color : COLORS.empty)).join('');
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
  // Only uniform 1- and 2-switch plans are drawable (see planIsRenderable).
  const config = {
    switches: plan.count24 + plan.count48,
    size: plan.count48 > 0 ? 48 : 24,
  };

  const udmHtml = buildUDMHtml(isAuto);

  const camGroup = cams > 0
    ? [{ prefix: 'UniFi Cam', courts: cams, color: COLORS.securitycam, ipFn: c => `.${10 + c}` }]
    : [];

  // Switch only gets readers #1 onward (UDM has the unnumbered one)
  const kisiGroups = kisiOnSwitch > 0 ? [
    { prefix: 'Kisi Reader', courts: kisiOnSwitch, color: COLORS.kisi,
      nameFn: n => `Kisi Reader\n#${n + kisi.readersOnUdm}`,
      ipFn: c => `.${10 + c + kisi.readersOnUdm}` },
  ] : [];

  let switchesHtml = '';

  if (config.switches === 1) {
    const cols = buildSwitchPorts([
      { prefix: 'iPad',       courts, color: COLORS.ipad,    ipFn: c => `.${20 + c}` },
      { prefix: 'Replay Cam', courts, color: COLORS.camera,  ipFn: c => `.${30 + c}` },
      { prefix: 'Apple TV',   courts, color: COLORS.appletv, ipFn: c => `.${40 + c}` },
      ...camGroup,
      ...kisiGroups,
    ], config.size);

    switchesHtml = `
      <div class="row">
        ${udmHtml}
        ${buildSwitchHtml(`${config.size} Port Switch`, cols)}
      </div>`;

  } else {
    const sw1Cols = buildSwitchPorts([
      { prefix: 'iPad',       courts, color: COLORS.ipad,   ipFn: c => `.${20 + c}` },
      { prefix: 'Replay Cam', courts, color: COLORS.camera, ipFn: c => `.${30 + c}` },
    ], config.size);

    const sw2ExtraLabel = [
      cams > 0 ? 'Security Cams' : null,
      isAuto    ? 'Kisi'         : null,
    ].filter(Boolean).join(' + ');

    const sw2Cols = buildSwitchPorts([
      { prefix: 'Apple TV', courts, color: COLORS.appletv, ipFn: c => `.${40 + c}` },
      ...camGroup,
      ...kisiGroups,
    ], config.size);

    switchesHtml = `
      <div class="row">
        ${udmHtml}
        ${buildSwitchHtml('Switch 1 (48-port) — iPads + Cameras', sw1Cols)}
      </div>
      <div class="row" style="margin-top:24px;">
        ${buildSwitchHtml(`Switch 2 (48-port) — Apple TVs${sw2ExtraLabel ? ` + ${sw2ExtraLabel}` : ''}`, sw2Cols)}
      </div>`;
  }

  const tierLabel = isAuto ? 'Auto' : 'Pro';
  const doorsLabel = isAuto ? ` | ${doors} Doors` : '';
  const camsLabel  = cams > 0 ? ` | ${cams} Security Cams` : '';

  const camLegend = cams > 0 ? `
    <div style="display:flex;align-items:center;gap:5px;">
      <div style="width:14px;height:14px;background:#E2D9F3;border:1px solid #000;flex-shrink:0;"></div>
      <span>UniFi Cam — ${surveillanceNet}.(10+N)</span>
    </div>` : '';

  const kisiLegend = isAuto ? `
    <div style="display:flex;align-items:center;gap:5px;">
      <div style="width:14px;height:14px;background:#FFF2CC;border:1px solid #000;flex-shrink:0;"></div>
      <span>Kisi — ${accessNet}.10+ (Controller .10, Readers .11+)</span>
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
      <span>Camera — ${replayNet}.(30+N)</span>
    </div>
    <div style="display:flex;align-items:center;gap:5px;">
      <div style="width:14px;height:14px;background:#FCE4D6;border:1px solid #000;flex-shrink:0;"></div>
      <span>Apple TV — ${replayNet}.(40+N)</span>
    </div>
    <div style="display:flex;align-items:center;gap:5px;">
      <div style="width:14px;height:14px;background:#D6DCE4;border:1px solid #000;flex-shrink:0;"></div>
      <span>Mac Mini — ${replayNet}.100</span>
    </div>
    ${camLegend}
    ${kisiLegend}
    <span style="color:#555;">N = court/device number</span>
  </div>
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
  if (!planIsRenderable(plan)) {
    console.error(`This venue sizes to ${plan.count24}x 24-port + ${plan.count48}x 48-port (${ports} ports).`);
    console.error('This tool can only draw one switch, or two of the same size.');
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
