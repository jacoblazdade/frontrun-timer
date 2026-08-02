// Shareable finisher card — a 1080×1920 (Instagram-story) image rendered
// entirely on a canvas, so it downloads / shares as a crisp PNG with no extra
// dependency. Doubles as advertising: it carries the Frontrun identity and the
// event hashtag.
//
// Layout is a left-aligned editorial grid hung off a single margin, with the
// header and spec row anchored and the athlete block centred between them.
// Everything used to be centred on one axis at fixed y constants, which is
// what made it read as a generated poster.
import { useCallback, useEffect, useRef, useState } from "react";
import { type ResultRow } from "../api";
import { ModalOverlay } from "../components";

const W = 1080;
const H = 1920;
const M = 96; // outer margin — everything hangs off this left edge
const CW = W - M * 2;

// same two families as the app, so the card and the results page look related
const DISPLAY = 'Archivo, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TEXT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const RAINBOW = ["#ff2d9b", "#ff9d2e", "#ffe600", "#33d15a", "#1fa9e6", "#a06fe0"];
const YELLOW = "#ffe600";
const INK = "#ffffff";
const DIM = "#9fb0e8";
const RULE = "rgba(255, 255, 255, 0.16)";
// podium colours match the app's dark-theme medal palette
const MEDAL = ["#ffd23f", "#cdd6f4", "#e8a866"];

/** Rules the composition hangs from; the athlete block centres between them. */
const HEAD_RULE = 300;
const SPEC_RULE = 1430;

type Style = {
  size: number;
  weight?: number;
  family?: string;
  /** canvas only accepts keywords here, not the percentages CSS allows */
  stretch?: CanvasFontStretch;
  tracking?: number;
};

/**
 * Canvas ignores `fontStretch` / `letterSpacing` where unsupported (they need
 * Chrome 110+ / Safari 17.4+), which degrades to normal width and tracking
 * rather than breaking the layout — so they're set separately from `font`,
 * never folded into the shorthand where a parse failure would silently keep
 * the previous size.
 */
function setFont(ctx: CanvasRenderingContext2D, s: Style) {
  ctx.font = `${s.weight ?? 700} ${s.size}px ${s.family ?? DISPLAY}`;
  ctx.fontStretch = s.stretch ?? "normal";
  ctx.letterSpacing = `${s.tracking ?? 0}px`;
}

function rainbowStrip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const band = w / RAINBOW.length;
  RAINBOW.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(x + i * band, y, band + 1, h);
  });
}

function rainbowGradient(ctx: CanvasRenderingContext2D, x0: number, x1: number) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  RAINBOW.forEach((c, i) => g.addColorStop(i / (RAINBOW.length - 1), c));
  return g;
}

function rule(ctx: CanvasRenderingContext2D, y: number) {
  ctx.fillStyle = RULE;
  ctx.fillRect(M, y, CW, 2);
}

/** Largest size (≤ style.size) at which `text` fits `maxWidth`. */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  style: Style,
  floor = 24
) {
  let px = style.size;
  while (px > floor) {
    setFont(ctx, { ...style, size: px });
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 4;
  }
  return px;
}

/**
 * Break points for a name. Double-barrelled names are the reason this exists:
 * "Schweighöfer-Wittelsbach" is one token to `split(" ")`, so a naive wrap
 * leaves an unbreakable 24-character word and the whole name gets shrunk to
 * fit it. Splitting after hyphens keeps the type large.
 * Written without lookbehind — Safari only shipped that in 16.4.
 */
function nameParts(name: string): string[] {
  return name.split(/\s+/).flatMap((word) => {
    if (!word.includes("-") || word.length < 2) return [word];
    const out: string[] = [];
    let cur = "";
    for (const ch of word) {
      cur += ch;
      if (ch === "-") {
        out.push(cur);
        cur = "";
      }
    }
    if (cur) out.push(cur);
    return out;
  });
}

/** Greedy wrap at the current font. Parts ending in "-" join without a space. */
function wrap(ctx: CanvasRenderingContext2D, parts: string[], maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const part of parts) {
    const next = line === "" ? part : line + (line.endsWith("-") ? "" : " ") + part;
    if (line !== "" && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = part;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest size at which `name` wraps into at most `maxLines` lines. */
function layoutName(
  ctx: CanvasRenderingContext2D,
  name: string,
  maxWidth: number,
  style: Style,
  maxLines: number
) {
  const parts = nameParts(name);
  for (let px = style.size; px >= 48; px -= 4) {
    setFont(ctx, { ...style, size: px });
    const lines = wrap(ctx, parts, maxWidth);
    // line count alone isn't enough: a name with no break opportunity
    // ("Bartholomäusberger") always wraps to one line however wide it is, so
    // without the fit check it would ship ellipsised at full size instead of
    // simply being set smaller
    const fits = lines.every((l) => ctx.measureText(l).width <= maxWidth);
    if (lines.length <= maxLines && fits) return { px, lines };
  }
  setFont(ctx, { ...style, size: 48 });
  const lines = wrap(ctx, parts, maxWidth);
  // a single token wider than the card still has to go somewhere; the last
  // kept line gets ellipsised by the caller
  return { px: 48, lines: lines.slice(0, maxLines) };
}

/** German numeric date: 2026-08-09 → 09.08.2026. */
function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d.padStart(2, "0")}.${m.padStart(2, "0")}.${y}`;
}

function draw(ctx: CanvasRenderingContext2D, row: ResultRow, eventName: string, eventDate: string) {
  const year = Number(eventDate.slice(0, 4));

  // --- background ---
  // A restrained vertical gradient. The previous version also painted a large
  // radial halo behind the middle third, which was the single most
  // generated-looking thing on the card.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#101d5e");
  bg.addColorStop(1, "#070e38");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // the rainbow appears once, as on the page — it used to run top strip,
  // bottom strip, wordmark and time underline, which made it wallpaper
  rainbowStrip(ctx, 0, 0, W, 16);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // --- header ---
  setFont(ctx, { size: 68, weight: 800, stretch: "expanded", tracking: 1 });
  const brandW = ctx.measureText("FRONTRUN").width;
  ctx.fillStyle = rainbowGradient(ctx, M, M + brandW);
  ctx.fillText("FRONTRUN", M, 202);

  setFont(ctx, { size: 30, weight: 500, family: TEXT });
  ctx.fillStyle = DIM;
  ctx.fillText(`${eventName} · ${formatDate(eventDate)}`, M, 252);

  rule(ctx, HEAD_RULE);

  // --- middle block: category, name, finish time ---
  // Measured first, then centred between the two rules, so a one-line and a
  // two-line name both sit balanced instead of hanging off fixed constants.
  const catSize = 27;
  const labelSize = 27;

  const nameStyle = { size: 98, weight: 700, stretch: "semi-expanded" as const };
  const { px: namePx, lines: nameLines } = layoutName(ctx, row.name, CW, nameStyle, 3);
  const nameLead = namePx * 1.06;

  const timeStyle = { size: 208, weight: 800, stretch: "semi-expanded" as const };
  const timePx = fitFont(ctx, row.time, CW, timeStyle);

  // The gap between the identity block and the hero is deliberately the
  // largest one on the card — bigger than the margins above and below it — so
  // the two read as anchored panels rather than as a clump floating in space.
  const SPLIT = nameLines.length >= 3 ? 170 : 240;
  const blockH =
    catSize + 56 + nameLines.length * nameLead + SPLIT + labelSize + 52 + timePx;
  // clamp so a three-line name can never ride up over the header rule
  let y =
    Math.max(HEAD_RULE + 80, HEAD_RULE + (SPEC_RULE - HEAD_RULE - blockH) / 2) + catSize;

  setFont(ctx, { size: catSize, weight: 600, family: TEXT, tracking: 3 });
  ctx.fillStyle = YELLOW;
  ctx.fillText(row.category.toUpperCase(), M, y);
  y += 56;

  setFont(ctx, { ...nameStyle, size: namePx });
  ctx.fillStyle = INK;
  nameLines.forEach((l, i) =>
    ctx.fillText(fitText(ctx, l, CW), M, y + namePx * 0.78 + i * nameLead)
  );
  y += nameLines.length * nameLead + SPLIT;

  setFont(ctx, { size: labelSize, weight: 600, family: TEXT, tracking: 3 });
  ctx.fillStyle = DIM;
  ctx.fillText("FINISHER-ZEIT", M, y);
  y += 52;

  setFont(ctx, { ...timeStyle, size: timePx });
  ctx.fillStyle = INK;
  ctx.fillText(row.time, M, y + timePx * 0.74);

  // --- spec row: the race data as a labelled grid, like a results sheet ---
  rule(ctx, SPEC_RULE);

  // Weighted, not equal thirds: rank and bib are one to three digits, while a
  // German club name runs to forty characters. Splitting evenly left "Verein"
  // with ~7 characters of room.
  type Cell = { label: string; value: string; weight: number; colour?: string };
  const cells: Cell[] = [
    {
      label: "Platz",
      value: String(row.rank),
      weight: 1,
      colour: row.rank <= 3 ? MEDAL[row.rank - 1] : undefined,
    },
    { label: "Startnr.", value: String(row.bib), weight: 1.1 },
  ];
  if (row.club) cells.push({ label: "Verein", value: row.club, weight: 3 });
  else if (row.birth_year)
    cells.push({ label: "Jahrgang", value: String(row.birth_year), weight: 1.4 });

  const totalWeight = cells.reduce((sum, c) => sum + c.weight, 0);
  const valueStyle = { size: 54, weight: 700, stretch: "semi-expanded" as const };
  let x = M;
  cells.forEach((cell) => {
    const colW = (CW * cell.weight) / totalWeight;

    setFont(ctx, { size: 24, weight: 600, family: TEXT, tracking: 2.5 });
    ctx.fillStyle = DIM;
    ctx.fillText(cell.label.toUpperCase(), x, SPEC_RULE + 66);

    // long text values step down a little before they get ellipsised, so a
    // club reads as a club rather than as three letters and a dot
    const px = fitFont(ctx, cell.value, colW - 32, valueStyle, 32);
    setFont(ctx, { ...valueStyle, size: px });
    ctx.fillStyle = cell.colour ?? INK;
    ctx.fillText(fitText(ctx, cell.value, colW - 32), x, SPEC_RULE + 134);

    x += colW;
  });

  // --- footer ---
  setFont(ctx, { size: 30, weight: 600, family: TEXT, tracking: 3 });
  ctx.fillStyle = YELLOW;
  ctx.fillText(`#FRONTRUN${year}`, M, SPEC_RULE + 272);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 4 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

export function FinisherCard({
  row,
  eventName,
  eventDate,
  onClose,
}: {
  row: ResultRow;
  eventName: string;
  eventDate: string;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canShare, setCanShare] = useState(false);
  const [busy, setBusy] = useState(false);

  // Canvas has no font-loading fallback: if a face isn't parsed yet it draws
  // in the fallback and never repaints, so the card would silently ship in
  // system-ui. Ask for the two faces explicitly, then draw.
  useEffect(() => {
    let cancelled = false;
    const paint = async () => {
      try {
        await Promise.all([
          document.fonts.load("800 208px Archivo"),
          document.fonts.load("500 30px Inter"),
        ]);
      } catch {
        /* fall through and draw with whatever is available */
      }
      if (cancelled) return;
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) draw(ctx, row, eventName, eventDate);
    };
    void paint();
    return () => {
      cancelled = true;
    };
  }, [row, eventName, eventDate]);

  const fileName = `frontrun-${row.name.replace(/\s+/g, "-").toLowerCase()}.png`;

  const toBlob = () =>
    new Promise<Blob | null>((resolve) => canvasRef.current?.toBlob(resolve, "image/png"));

  // detect file sharing once (mobile Safari/Chrome → Instagram etc.)
  useEffect(() => {
    const test = new File([new Blob()], "x.png", { type: "image/png" });
    setCanShare(!!navigator.canShare && navigator.canShare({ files: [test] }));
  }, []);

  const download = useCallback(async () => {
    const blob = await toBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [fileName]);

  const share = useCallback(async () => {
    const blob = await toBlob();
    if (!blob) return;
    const file = new File([blob], fileName, { type: "image/png" });
    try {
      setBusy(true);
      await navigator.share({
        files: [file],
        title: `${row.name} — ${eventName}`,
        text: `${row.name}: ${row.time} beim ${eventName} (${row.category}, Platz ${row.rank}) 🏃`,
      });
    } catch {
      /* user dismissed the share sheet — nothing to do */
    } finally {
      setBusy(false);
    }
  }, [fileName, row, eventName]);

  return (
    <ModalOverlay onClick={onClose}>
      <div className="finisher-modal" onClick={(e) => e.stopPropagation()}>
        <canvas ref={canvasRef} width={W} height={H} className="finisher-preview" />
        <div className="finisher-actions">
          {canShare && (
            <button className="primary" onClick={share} disabled={busy}>
              Teilen
            </button>
          )}
          <button className={canShare ? "" : "primary"} onClick={download}>
            Herunterladen
          </button>
          <button onClick={onClose}>Schließen</button>
        </div>
      </div>
    </ModalOverlay>
  );
}
