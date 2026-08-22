// svg.js — the 2D plan as a vector drawing.
//
// A .rcad file is for RoomCAD; this is for everyone else — printing to scale,
// dropping into a document, opening in Illustrator or Inkscape. So it is drawn
// for paper rather than for the screen: white ground, black walls, real
// dimension lines, and a title block saying what it is and at what scale.
//
// It reads the room model and nothing else — no canvas, no DOM — so it can be
// tested directly.

import * as P from "./plan.js";

const MM_PER_M = 1000;
const STROKE = "#111418";
const WALL_FILL = "#111418";
const FURNITURE_STROKE = "#7c8794";
const DIM_STROKE = "#5d6874";
const PUBLIC_FILL = "#e8f3e4";
const PUBLIC_STROKE = "#7aa86a";

function esc(text) {
  return String(text === undefined || text === null ? "" : text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const n = v => (Math.round(v * 100) / 100).toString();

/// Picks a drawing scale from the familiar architectural set, so the printed
/// sheet reads at a ratio people recognise rather than an arbitrary fit.
export function chooseScale(widthM, heightM, sheetW = 277, sheetH = 190) {
  const ladder = [20, 25, 50, 100, 200, 500];
  for (const denom of ladder) {
    const w = (widthM * MM_PER_M) / denom;
    const h = (heightM * MM_PER_M) / denom;
    // Either way up: a tall plan belongs on a portrait sheet, and forcing it
    // into landscape would drop it a whole step down the ladder for nothing.
    if ((w <= sheetW && h <= sheetH) || (w <= sheetH && h <= sheetW)) return denom;
  }
  return ladder[ladder.length - 1];
}

/// Renders `room` as a standalone SVG document.
export function roomToSVG(room, options = {}) {
  const bounds = P.wallsBounds(room) || {
    minX: P.roomOrigin(room).x,
    minZ: P.roomOrigin(room).z,
    maxX: P.roomOrigin(room).x + room.width,
    maxZ: P.roomOrigin(room).z + room.length,
  };
  const pad = 1.4;                      // metres of margin around the plan
  const minX = bounds.minX - pad;
  const minZ = bounds.minZ - pad;
  const planW = (bounds.maxX - bounds.minX) + pad * 2;
  const planH = (bounds.maxZ - bounds.minZ) + pad * 2;

  const denom = options.scale || chooseScale(planW, planH);
  const k = MM_PER_M / denom;           // millimetres on the sheet per metre
  const titleH = 16;
  // A tall narrow plan makes a tall narrow sheet, and the title block then has
  // less width than its own text needs. Give the sheet a floor.
  const MIN_SHEET_W = 92;
  const sheetW = Math.max(planW * k, MIN_SHEET_W);
  const sheetH = planH * k + titleH;
  const planOffsetX = (sheetW - planW * k) / 2;

  // Plan metres -> sheet millimetres.
  const X = x => (x - minX) * k + planOffsetX;
  const Y = z => (z - minZ) * k;

  const out = [];
  const push = (...parts) => out.push(...parts);

  push(`<svg xmlns="http://www.w3.org/2000/svg" version="1.1"`,
    ` width="${n(sheetW)}mm" height="${n(sheetH)}mm"`,
    ` viewBox="0 0 ${n(sheetW)} ${n(sheetH)}">\n`);
  push(`<title>${esc(room.name || "RoomCAD plan")}</title>\n`);
  push(`<rect width="100%" height="100%" fill="#ffffff"/>\n`);
  push(`<g stroke-linecap="butt" stroke-linejoin="miter">\n`);

  // --- public floor, under everything -------------------------------------
  for (const a of room.publicAreas || []) {
    push(`<rect x="${n(X(a.x))}" y="${n(Y(a.z))}" width="${n(a.w * k)}" height="${n(a.l * k)}"`,
      ` fill="${PUBLIC_FILL}" stroke="${PUBLIC_STROKE}" stroke-width="0.2" stroke-dasharray="1.2 0.8"/>\n`);
  }

  // --- walls, as solid bodies with the openings cut out --------------------
  const half = P.WALL_THICKNESS / 2;
  for (const wall of room.walls || []) {
    const len = P.wallLength(wall);
    if (len < 0.01) continue;
    const doorSpans = (room.doors || []).filter(d => d.wallID === wall.id)
      .map(d => ({ from: d.offset, to: d.offset + d.width }));
    const winSpans = (room.windows || []).filter(w => w.wallID === wall.id)
      .map(w => ({ from: w.offset, to: w.offset + w.width }));
    const angle = Math.atan2(wall.end.z - wall.start.z, wall.end.x - wall.start.x);
    const deg = (angle * 180) / Math.PI;
    const a = { x: X(wall.start.x), y: Y(wall.start.z) };
    // Each solid stretch is a rectangle along the wall's own axis.
    for (const span of P.solidSpans(len, [...doorSpans, ...winSpans])) {
      const w = (span.to - span.from) * k;
      if (w <= 0.01) continue;
      push(`<rect x="${n(span.from * k)}" y="${n(-half * k)}" width="${n(w)}" height="${n(P.WALL_THICKNESS * k)}"`,
        ` fill="${WALL_FILL}" transform="translate(${n(a.x)} ${n(a.y)}) rotate(${n(deg)})"/>\n`);
    }
    // Windows: a thin pane line across the gap.
    for (const span of winSpans) {
      push(`<line x1="${n(span.from * k)}" y1="0" x2="${n(span.to * k)}" y2="0"`,
        ` stroke="${STROKE}" stroke-width="0.35"`,
        ` transform="translate(${n(a.x)} ${n(a.y)}) rotate(${n(deg)})"/>\n`);
    }
    // Doors: the leaf, and the arc it sweeps — the convention on every plan.
    for (const door of (room.doors || []).filter(d => d.wallID === wall.id)) {
      const w = door.width * k;
      const sign = door.swingInside === false ? 1 : -1;
      const x0 = door.offset * k;
      push(`<g transform="translate(${n(a.x)} ${n(a.y)}) rotate(${n(deg)})" fill="none"`,
        ` stroke="${STROKE}" stroke-width="0.25">\n`);
      push(`  <path d="M ${n(x0)} 0 L ${n(x0)} ${n(sign * w)}"/>\n`);
      push(`  <path d="M ${n(x0)} ${n(sign * w)} A ${n(w)} ${n(w)} 0 0 ${sign < 0 ? 1 : 0} ${n(x0 + w)} 0"`,
        ` stroke-dasharray="1 0.7"/>\n`);
      push(`</g>\n`);
    }
  }

  // --- furniture ------------------------------------------------------------
  if (options.furniture !== false) {
    for (const item of room.furniture || []) {
      const kind = P.FURNITURE_KINDS[item.kind];
      if (!kind) continue;
      const f = P.furnitureFootprint(item);
      const w = (f.maxX - f.minX) * k;
      const h = (f.maxZ - f.minZ) * k;
      push(`<rect x="${n(X(f.minX))}" y="${n(Y(f.minZ))}" width="${n(w)}" height="${n(h)}"`,
        ` fill="none" stroke="${FURNITURE_STROKE}" stroke-width="0.25"/>\n`);
      if (w > 9 && h > 4) {
        push(`<text x="${n(X(f.minX) + w / 2)}" y="${n(Y(f.minZ) + h / 2 + 1)}"`,
          ` font-family="Helvetica, Arial, sans-serif" font-size="2.4" fill="${FURNITURE_STROKE}"`,
          ` text-anchor="middle">${esc(kind.title)}</text>\n`);
      }
    }
  }

  // --- room areas -----------------------------------------------------------
  if (options.areas !== false) {
    for (const region of P.detectRooms(room)) {
      if (!region.hasDoor) continue;
      const spot = P.captionSpot(room, region, 1.1 * denom / 100, 0.45 * denom / 100)
        || { x: (region.bounds.minX + region.bounds.maxX) / 2, z: (region.bounds.minZ + region.bounds.maxZ) / 2 };
      push(`<text x="${n(X(spot.x))}" y="${n(Y(spot.z))}"`,
        ` font-family="Helvetica, Arial, sans-serif" font-size="3" fill="#2b3138"`,
        ` text-anchor="middle">${esc(region.area.toFixed(1))} m²</text>\n`);
    }
  }

  // --- the user's own labels ------------------------------------------------
  for (const label of room.labels || []) {
    const size = Math.max(2.2, (label.size || P.LABEL_DEFAULT_SIZE) * k);
    push(`<text x="${n(X(label.center.x))}" y="${n(Y(label.center.z) + size * 0.35)}"`,
      ` font-family="Helvetica, Arial, sans-serif" font-size="${n(size)}" fill="#1b2027"`,
      ` text-anchor="middle" transform="rotate(${n(label.rotationDegrees)} ${n(X(label.center.x))} ${n(Y(label.center.z))})"`,
      `>${esc(label.text)}</text>\n`);
  }

  // --- dimensions, on the outside of the plan -------------------------------
  if (options.dimensions !== false) {
    push(`<g stroke="${DIM_STROKE}" stroke-width="0.15" fill="${DIM_STROKE}"`,
      ` font-family="Helvetica, Arial, sans-serif" font-size="2.4" text-anchor="middle">\n`);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    for (const wall of room.walls || []) {
      const len = P.wallLength(wall);
      if (len < 0.35) continue;                      // too short to letter
      const mx = (wall.start.x + wall.end.x) / 2;
      const mz = (wall.start.z + wall.end.z) / 2;
      const horizontal = Math.abs(wall.start.z - wall.end.z) < 0.001;
      const off = 3.2 * (horizontal ? (mz >= cz ? 1 : -1) : (mx >= cx ? 1 : -1));
      const x1 = X(wall.start.x) + (horizontal ? 0 : off);
      const y1 = Y(wall.start.z) + (horizontal ? off : 0);
      const x2 = X(wall.end.x) + (horizontal ? 0 : off);
      const y2 = Y(wall.end.z) + (horizontal ? off : 0);
      push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>\n`);
      const tx = (x1 + x2) / 2;
      const ty = (y1 + y2) / 2;
      const rot = horizontal ? 0 : -90;
      push(`<text x="${n(tx)}" y="${n(ty - 0.9)}" transform="rotate(${rot} ${n(tx)} ${n(ty)})"`,
        ` stroke="none">${esc(P.cm(len))}</text>\n`);
    }
    push(`</g>\n`);
  }

  push(`</g>\n`);

  // --- title block ----------------------------------------------------------
  const baseY = planH * k;
  const area = (room.width * room.length).toFixed(2);
  push(`<g font-family="Helvetica, Arial, sans-serif" fill="#1b2027">\n`);
  push(`  <line x1="0" y1="${n(baseY)}" x2="${n(sheetW)}" y2="${n(baseY)}" stroke="${STROKE}" stroke-width="0.3"/>\n`);
  push(`  <text x="2" y="${n(baseY + 6)}" font-size="4.4" font-weight="bold">${esc(room.name || "Room")}</text>\n`);
  // Everything else on one left-aligned line, so nothing can collide with a
  // right-aligned item however narrow the sheet gets.
  const meta = [
    `${P.cm(room.width)} × ${P.cm(room.length)}`,
    `${area} m²`,
    `walls ${P.cm(room.height)} high`,
    options.date || "",
    "RoomCAD",
  ].filter(Boolean).join(" · ");
  push(`  <text x="2" y="${n(baseY + 11.5)}" font-size="2.6" fill="#5d6874">${esc(meta)}</text>\n`);
  push(`  <text x="${n(sheetW - 2)}" y="${n(baseY + 6)}" font-size="3.2" text-anchor="end">1 : ${denom}</text>\n`);
  push(`</g>\n`);
  push(`</svg>\n`);
  return out.join("");
}
