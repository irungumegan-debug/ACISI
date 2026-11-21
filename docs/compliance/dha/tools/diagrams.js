// Builds simple box-and-arrow SVG diagrams and renders each to PNG with Playwright.
const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2];
const NAVY = '#14213d', GOLD = '#b8892d', GREY = '#5b6270', LIGHT = '#eef1f6', KE = '#e7f4ea';

function box(x, y, w, h, title, lines = [], opts = {}) {
  const fill = opts.fill || '#ffffff', stroke = opts.stroke || NAVY;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${opts.dash ? 1.5 : 2}" ${opts.dash ? 'stroke-dasharray="6 4"' : ''}/>`;
  s += `<text x="${x + w / 2}" y="${y + 22}" text-anchor="middle" font-weight="700" font-size="14" fill="${NAVY}">${title}</text>`;
  lines.forEach((l, i) => (s += `<text x="${x + w / 2}" y="${y + 42 + i * 16}" text-anchor="middle" font-size="12" fill="${GREY}">${l}</text>`));
  return s;
}
function zone(x, y, w, h, label, fill) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${GOLD}" stroke-width="1.5" stroke-dasharray="8 5"/><text x="${x + 12}" y="${y + 20}" font-size="12" font-weight="700" fill="${GOLD}">${label}</text>`;
}
function arrow(x1, y1, x2, y2, label = '', opts = {}) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  let s = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${opts.color || NAVY}" stroke-width="1.6" marker-end="url(#a)" ${opts.dash ? 'stroke-dasharray="5 4"' : ''} ${opts.both ? 'marker-start="url(#b)"' : ''}/>`;
  if (label) {
    const lines = label.split('|');
    lines.forEach((l, i) => (s += `<text x="${mx + (opts.dx || 0)}" y="${my + (opts.dy || -6) + i * 13}" text-anchor="middle" font-size="11" fill="${GREY}" paint-order="stroke" stroke="#fff" stroke-width="4">${l}</text>`));
  }
  return s;
}
const defs = `<defs><marker id="a" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="${NAVY}"/></marker><marker id="b" markerWidth="10" markerHeight="8" refX="1" refY="4" orient="auto"><path d="M10,0 L0,4 L10,8 z" fill="${NAVY}"/></marker></defs>`;
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="Arial, Helvetica, sans-serif" style="background:#fff">${defs}${body}</svg>`;

const D = {};
// 2.2 Business context
D.context = svg(1000, 560,
  box(390, 220, 220, 110, 'ACISI', ['Clinic management system', 'acisi.co.ke'], { fill: LIGHT }) +
  box(30, 40, 200, 70, 'Patients', ['web portal, SMS (USSD planned)']) +
  box(30, 250, 200, 70, 'Clinic front desk', ['check-in, queue, billing']) +
  box(30, 450, 200, 70, 'Doctors & clinicians', ['consultation, orders']) +
  box(400, 450, 200, 70, 'Lab technicians', ['lab requests, results']) +
  box(400, 40, 200, 70, 'Clinic admins', ['staff, settings, reports']) +
  box(770, 30, 200, 70, 'Safaricom M-Pesa', ['Daraja API: payments']) +
  box(770, 130, 200, 70, "Africa's Talking", ['SMS (USSD planned)']) +
  box(770, 230, 200, 70, 'DHA national HIE', ['registries, Shared', 'Health Record (planned)'], { dash: true }) +
  box(770, 330, 200, 70, 'Sub-County public health', ['IDSR reports (by clinic)']) +
  box(770, 450, 200, 70, 'ACISI owner / DPO', ['platform administration']) +
  arrow(230, 75, 395, 230) + arrow(230, 285, 390, 275) + arrow(230, 485, 395, 320) + arrow(500, 450, 500, 332) + arrow(500, 110, 500, 218) +
  arrow(612, 245, 768, 65, '', { both: true }) + arrow(612, 260, 768, 165) + arrow(612, 275, 768, 265, '', { both: true, dash: true }) + arrow(612, 300, 768, 365, '', { dash: true }) + arrow(610, 320, 768, 480, '', { both: true }));
// 3.2 High-level architecture
D.highlevel = svg(1000, 640,
  zone(20, 20, 960, 90, 'USERS (browsers, phones)', '#fff') +
  box(40, 45, 180, 55, 'Patient portal', ['React SPA at /']) + box(240, 45, 180, 55, 'Staff console', ['React SPA at /console']) + box(440, 45, 180, 55, 'Owner site', ['React SPA at /owner']) + box(640, 45, 160, 55, 'Phones', ['SMS (USSD planned)']) +
  box(820, 45, 150, 55, 'Cloudflare', ['DNS only, no proxy'], { dash: true }) +
  zone(20, 140, 960, 480, 'HOSTAFRICA VPS, NAIROBI DATA CENTRE (Ubuntu 24.04)', KE) +
  box(330, 175, 340, 70, 'Nginx (TLS 1.2/1.3, HSTS, CSP)', ["Let's Encrypt certificate, ports 80/443 only"]) +
  box(250, 290, 500, 120, 'ACISI application (Node.js, Express, TypeScript)', ['REST APIs: /api/staff, /api/patients, /api/owner, /api/mpesa', 'FHIR R4 interface: /fhir/r4', 'Serves the three web apps; health check /healthz', 'Background workers (BullMQ): SMS, payments, HIE, reports']) +
  box(60, 470, 230, 110, 'PostgreSQL 18', ['primary database, localhost only', 'health fields AES-256-GCM', 'append-only audit log']) +
  box(330, 470, 200, 110, 'Redis', ['sessions, job queues', 'localhost only, 64 MB']) +
  box(570, 470, 180, 110, 'Uploaded files', ['/var/lib/acisi/uploads', 'encrypted on disk']) +
  box(790, 470, 170, 110, 'Nightly backups', ['encrypted (age)', '14 days, on the', 'same server today']) +
  arrow(130, 100, 420, 175) + arrow(330, 100, 470, 175) + arrow(530, 100, 520, 175) + arrow(500, 245, 500, 288) +
  arrow(330, 410, 200, 468, '', { both: true }) + arrow(430, 410, 430, 468, '', { both: true }) + arrow(600, 410, 650, 468, '', { both: true }) + arrow(700, 410, 860, 468) +
  box(800, 270, 160, 150, 'Outbound HTTPS', ['Safaricom Daraja', "Africa's Talking", 'DHA HIE (when', 'connected)'], { dash: true }) + arrow(750, 345, 798, 345));
// 5.1 Data flow L1
D.dfd = svg(1000, 600,
  box(30, 40, 190, 60, 'Patient', []) + box(30, 260, 190, 60, 'Front desk', []) + box(30, 480, 190, 60, 'Doctor / lab', []) +
  box(780, 40, 190, 60, "Africa's Talking", []) + box(780, 170, 190, 60, 'Safaricom M-Pesa', []) + box(780, 360, 190, 60, 'DHA HIE', ['(when connected)'], { dash: true }) + box(780, 500, 190, 60, 'Sub-County officer', []) +
  box(330, 30, 300, 70, 'P1 Register & check in', ['identity, consent, queue']) +
  box(330, 150, 300, 70, 'P2 Pay & bill', ['check-in fee, visit bill']) +
  box(330, 270, 300, 70, 'P3 Consult & order', ['diagnosis, Rx, labs, vitals']) +
  box(330, 390, 300, 70, 'P4 Report', ['IDSR, routine, quality']) +
  box(330, 510, 300, 60, 'D1 Database  ·  D2 Files  ·  D3 Audit log', [], { fill: LIGHT }) +
  arrow(220, 70, 328, 65, 'name, phone, ID|HTTPS', { dy: -24 }) + arrow(220, 290, 328, 75, 'walk-in check-in', { dx: -55, dy: 0 }) + arrow(220, 290, 328, 185, 'payments|HTTPS', { dx: 40, dy: 20 }) + arrow(220, 510, 328, 305, 'clinical record|HTTPS', { dx: -50 }) +
  arrow(630, 185, 778, 200, 'STK push / result|HTTPS', { both: true, dy: -22 }) + arrow(630, 65, 778, 70, 'SMS text (no diagnosis)|HTTPS', { dy: -22 }) + arrow(630, 305, 778, 390, 'FHIR bundle, consented|HTTPS', { both: true, dash: true }) + arrow(630, 425, 778, 530, 'counts only|by clinic staff', { dash: true }) +
  arrow(480, 100, 480, 148) + arrow(480, 220, 480, 268) + arrow(480, 340, 480, 388) + arrow(480, 460, 480, 508, 'read / write', { dx: 50 }));
// 6.2 Network security
D.network = svg(1000, 560,
  box(30, 230, 170, 80, 'Internet', ['users, partners']) +
  zone(240, 40, 730, 490, 'HOSTAFRICA VPS (single host), NAIROBI', KE) +
  zone(270, 80, 220, 420, 'PUBLIC EDGE', '#ffffff') +
  box(285, 120, 190, 110, 'Firewall (ufw)', ['allow 22, 80, 443 only', 'deny all other inbound']) +
  box(285, 260, 190, 90, 'fail2ban', ['SSH: 5 failures / 10 min', '→ 1 hour ban']) +
  box(285, 380, 190, 100, 'Nginx :443', ['TLS 1.2/1.3, HSTS', 'HTTP :80 → HTTPS', 'proxies to app on 127.0.0.1']) +
  zone(520, 80, 430, 420, 'INTERNAL (localhost only)', '#ffffff') +
  box(545, 110, 380, 80, 'ACISI app :3000 (127.0.0.1)', ['runs as user "acisi" under systemd']) +
  box(545, 230, 180, 80, 'PostgreSQL :5432', ['127.0.0.1 only']) + box(745, 230, 180, 80, 'Redis :6379', ['127.0.0.1 only']) +
  box(545, 350, 380, 120, 'Administration', ['SSH :22 key-only, no root, no passwords', 'settings file root-only (/etc/acisi)', 'emergency: provider VNC console']) +
  arrow(200, 270, 283, 175, 'HTTPS / SSH', { dx: -45, dy: -10 }) + arrow(380, 230, 380, 258) + arrow(380, 350, 380, 378) + arrow(475, 420, 543, 150) + arrow(640, 190, 640, 228) + arrow(830, 190, 830, 228));
// 8.3 Delivery pipeline
D.cicd = svg(1000, 300,
  box(20, 60, 150, 90, 'Source', ['GitHub repository', 'branch per change']) +
  box(200, 60, 150, 90, 'Build & test', ['tsc, ESLint, Jest', '~1,260 tests']) +
  box(380, 60, 150, 90, 'Review', ['pull request', 'owner approves', 'and merges']) +
  box(560, 60, 150, 90, 'Backup', ['encrypted DB +', 'files backup', 'before update']) +
  box(740, 60, 150, 90, 'Production', ['git pull, npm ci,', 'build, restart;', 'migrations on start']) +
  box(870, 190, 120, 80, 'Verify', ['/healthz,', 'logs, checklist']) +
  arrow(170, 105, 198, 105) + arrow(350, 105, 378, 105) + arrow(530, 105, 558, 105) + arrow(710, 105, 738, 105) + arrow(860, 150, 910, 188) +
  `<text x="20" y="215" font-size="12" fill="${GREY}">Manual, documented release (runbook "Updating the app"). No separate staging server yet; automated CI is a planned improvement.</text>` +
  `<text x="20" y="235" font-size="12" fill="${GREY}">Each database change ships with an undo script (prisma/rollback/). Development uses Docker Compose (PostgreSQL, Redis) on the developer's machine.</text>`);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 2 });
  for (const [k, s] of Object.entries(D)) {
    await p.setContent(`<html><body style="margin:0">${s}</body></html>`);
    await p.locator('svg').screenshot({ path: `${out}/${k}.png` });
    fs.writeFileSync(`${out}/${k}.svg`, s);
  }
  await b.close();
  console.log('ok');
})();
