// Shareable finisher card — a 1080×1920 (Instagram-story) image rendered
// entirely on a canvas, so it downloads / shares as a crisp PNG with no extra
// dependency. Doubles as advertising: it carries the Frontrun identity and a
// call-to-action for next year's run.
import { useCallback, useEffect, useRef, useState } from "react";
import { type ResultRow } from "../api";
import { ModalOverlay } from "../components";

const W = 1080;
const H = 1920;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const RAINBOW = ["#ff2d9b", "#ff9d2e", "#ffe600", "#33d15a", "#1fa9e6", "#a06fe0"];
const YELLOW = "#ffe600";
const INK = "#ffffff";
const DIM = "#9fb0e8";

const MEDALS = ["🥇", "🥈", "🥉"];

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

/** Largest font size (≤ start) at which `text` fits `maxWidth`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number, weight = 800) {
  let px = start;
  while (px > 24) {
    ctx.font = `${weight} ${px}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 4;
  }
  return px;
}

function formatDate(iso: string) {
  const months = ["Jan", "Feb", "März", "Apr", "Mai", "Juni", "Juli", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}. ${months[(m ?? 1) - 1]} ${y}`;
}

function draw(ctx: CanvasRenderingContext2D, row: ResultRow, eventName: string, eventDate: string) {
  const cx = W / 2;
  const year = Number(eventDate.slice(0, 4));
  const nextYear = year + 1;

  // --- background: deep navy with a soft top glow ---
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#101f60");
  bg.addColorStop(0.55, "#0b1650");
  bg.addColorStop(1, "#070e38");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(cx, 430, 40, cx, 430, 760);
  glow.addColorStop(0, "rgba(70, 100, 210, 0.5)");
  glow.addColorStop(1, "rgba(70, 100, 210, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // inner hairline frame
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  rainbowStrip(ctx, 0, 0, W, 22);
  rainbowStrip(ctx, 0, H - 22, W, 22);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // --- brand header ---
  ctx.letterSpacing = "14px";
  ctx.font = `800 78px ${FONT}`;
  ctx.fillStyle = rainbowGradient(ctx, cx - 300, cx + 300);
  ctx.fillText("FRONTRUN", cx + 7, 205); // +7 balances the letter-spacing
  ctx.letterSpacing = "6px";
  ctx.font = `700 32px ${FONT}`;
  ctx.fillStyle = DIM;
  ctx.fillText(`${eventName.toUpperCase()}  ·  ${formatDate(eventDate).toUpperCase()}`, cx + 3, 263);
  ctx.letterSpacing = "0px";

  // --- eyebrow: category ---
  ctx.letterSpacing = "10px";
  ctx.font = `800 40px ${FONT}`;
  ctx.fillStyle = YELLOW;
  ctx.fillText(row.category.toUpperCase(), cx + 5, 560);
  ctx.letterSpacing = "0px";

  // --- name (wraps to 2 lines if needed) ---
  ctx.fillStyle = INK;
  const nameMax = W - 200;
  ctx.font = `800 92px ${FONT}`;
  let nameLines = [row.name];
  if (ctx.measureText(row.name).width > nameMax) {
    const words = row.name.split(" ");
    const mid = Math.ceil(words.length / 2);
    nameLines = [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }
  const namePx = Math.min(92, ...nameLines.map((l) => fitFont(ctx, l, nameMax, 92)));
  ctx.font = `800 ${namePx}px ${FONT}`;
  nameLines.forEach((l, i) => ctx.fillText(l, cx, 668 + i * (namePx + 14)));

  // --- placement pill ---
  const podium = row.rank <= 3;
  const placeText = `${podium ? MEDALS[row.rank - 1] + "  " : ""}PLATZ ${row.rank}`;
  const pillY = nameLines.length > 1 ? 800 : 730;
  ctx.font = `800 46px ${FONT}`;
  const pillW = ctx.measureText(placeText).width + 90;
  const pillH = 88;
  const pillX = cx - pillW / 2;
  ctx.fillStyle = podium ? YELLOW : "rgba(255,255,255,0.08)";
  roundRect(ctx, pillX, pillY, pillW, pillH, 44);
  ctx.fill();
  if (!podium) {
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    roundRect(ctx, pillX, pillY, pillW, pillH, 44);
    ctx.stroke();
  }
  ctx.fillStyle = podium ? "#0b1650" : INK;
  ctx.fillText(placeText, cx, pillY + 60);

  // --- hero: finish time ---
  ctx.letterSpacing = "8px";
  ctx.font = `700 36px ${FONT}`;
  ctx.fillStyle = DIM;
  ctx.fillText("FINISHER-ZEIT", cx + 4, 1010);
  ctx.letterSpacing = "0px";

  const timePx = fitFont(ctx, row.time, W - 180, 220);
  ctx.font = `800 ${timePx}px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText(row.time, cx, 1215);
  // rainbow underline under the time
  const uW = Math.min(W - 260, ctx.measureText(row.time).width + 40);
  rainbowStrip(ctx, cx - uW / 2, 1258, uW, 12);

  // --- meta: bib + club ---
  ctx.font = `600 38px ${FONT}`;
  ctx.fillStyle = DIM;
  const meta = [`Startnr. ${row.bib}`, row.club, row.birth_year ? `Jg. ${row.birth_year}` : null]
    .filter(Boolean)
    .join("   ·   ");
  ctx.fillText(fitText(ctx, meta, W - 160), cx, 1370);

  // --- footer CTA (the advertising) ---
  ctx.letterSpacing = "4px";
  ctx.font = `800 46px ${FONT}`;
  ctx.fillStyle = YELLOW;
  ctx.fillText(`LÄUFST DU ${nextYear} WIEDER MIT?`, cx + 2, 1660);
  ctx.letterSpacing = "6px";
  ctx.font = `700 34px ${FONT}`;
  ctx.fillStyle = DIM;
  ctx.fillText(`#FRONTRUN${nextYear}`, cx + 3, 1722);
  ctx.letterSpacing = "0px";
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 4 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) draw(ctx, row, eventName, eventDate);
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
