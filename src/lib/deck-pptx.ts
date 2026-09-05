// Client-side PowerPoint export for the public FarmOps decks.
//
// Turns the same PromoSlide content the browser renders into a .pptx file.
// Text only: the on-screen decks carry screenshots and gradients that a static
// file cannot reproduce faithfully, so the export is a plain, readable handout.
//
// pptxgenjs is browser-only, so this module must be imported dynamically from a
// click handler — never at module scope in a route.
import { type PromoSlide } from "@/lib/promo-slides";

/** Deck palette as literal hex (pptxgenjs takes 6-char hex, not CSS tokens). */
const INK = "1C1917";
const MUTED = "57534E";
const ACCENT = "B45309";
const PAPER = "FFFFFF";
const BAND = "FDF6EC";

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Builds and downloads a .pptx handout for a deck.
 * Returns the filename that was saved.
 */
export async function downloadDeckPptx(options: {
  slides: PromoSlide[];
  deckTitle: string;
  fileBase: string;
}): Promise<string> {
  const { slides, deckTitle, fileBase } = options;
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9"; // 10in x 5.63in
  pptx.title = deckTitle;
  pptx.company = "FarmOps";

  const W = 10;
  const M = 0.6;
  const BODY_W = W - M * 2;

  slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: i === 0 ? BAND : PAPER };

    if (s.kind === "title" || s.kind === "cta") {
      const lead = s.kind === "title" ? s.subtitle : s.lead;
      slide.addText(clean(s.kicker).toUpperCase(), {
        x: M, y: 0.7, w: BODY_W, h: 0.3, fontSize: 12, bold: true, color: ACCENT,
        charSpacing: 2, fontFace: "Calibri",
      });
      slide.addText(clean(s.title), {
        x: M, y: 1.1, w: BODY_W, h: 1.3, fontSize: 34, bold: true, color: INK,
        fontFace: "Georgia", valign: "top",
      });
      slide.addText(clean(lead), {
        x: M, y: 2.5, w: BODY_W, h: 1.5, fontSize: 15, color: MUTED, fontFace: "Calibri",
        valign: "top",
      });
      if (s.kind === "cta" && s.actions.length) {
        slide.addText(s.actions.map((a) => ({ text: clean(a), options: { bullet: true } })), {
          x: M, y: 3.9, w: BODY_W, h: 1.0, fontSize: 13, color: INK, fontFace: "Calibri",
        });
      }
      slide.addText(clean(s.footer), {
        x: M, y: 4.95, w: BODY_W, h: 0.35, fontSize: 11, color: ACCENT, fontFace: "Calibri",
      });
      return;
    }

    // Every other layout shares a kicker + title header.
    slide.addText(clean(s.kicker).toUpperCase(), {
      x: M, y: 0.45, w: BODY_W, h: 0.3, fontSize: 11, bold: true, color: ACCENT,
      charSpacing: 2, fontFace: "Calibri",
    });
    slide.addText(clean(s.title), {
      x: M, y: 0.78, w: BODY_W, h: 0.85, fontSize: 26, bold: true, color: INK,
      fontFace: "Georgia", valign: "top",
    });

    if (s.kind === "statement") {
      slide.addText(clean(s.lead), {
        x: M, y: 1.7, w: BODY_W, h: 0.75, fontSize: 14, color: MUTED, fontFace: "Calibri",
        valign: "top",
      });
      slide.addText(s.bullets.map((b) => ({ text: clean(b), options: { bullet: true } })), {
        x: M, y: 2.5, w: BODY_W, h: 2.2, fontSize: 13, color: INK, fontFace: "Calibri",
        lineSpacingMultiple: 1.2, valign: "top",
      });
      if (s.note) {
        slide.addText(clean(s.note), {
          x: M, y: 4.75, w: BODY_W, h: 0.5, fontSize: 11, italic: true, color: MUTED,
          fontFace: "Calibri",
        });
      }
      return;
    }

    if (s.kind === "shot") {
      slide.addText(clean(s.claim), {
        x: M, y: 1.7, w: BODY_W, h: 0.7, fontSize: 14, color: MUTED, fontFace: "Calibri",
        valign: "top",
      });
      slide.addText(s.points.map((p) => ({ text: clean(p), options: { bullet: true } })), {
        x: M, y: 2.45, w: BODY_W, h: 2.3, fontSize: 13, color: INK, fontFace: "Calibri",
        lineSpacingMultiple: 1.2, valign: "top",
      });
      slide.addText(`In the app: ${clean(s.route)}`, {
        x: M, y: 4.8, w: BODY_W, h: 0.4, fontSize: 11, color: ACCENT, fontFace: "Calibri",
      });
      return;
    }

    if (s.kind === "cards") {
      const cards = s.cards.slice(0, 4);
      const cols = cards.length <= 2 ? cards.length : 2;
      const rows = Math.ceil(cards.length / cols);
      const gap = 0.25;
      const cw = (BODY_W - gap * (cols - 1)) / cols;
      const ch = rows === 1 ? 2.5 : 1.35;
      cards.forEach((c, ci) => {
        const col = ci % cols;
        const row = Math.floor(ci / cols);
        const x = M + col * (cw + gap);
        const y = 1.75 + row * (ch + gap);
        slide.addShape(pptx.ShapeType.roundRect, {
          x, y, w: cw, h: ch, fill: { color: BAND }, line: { color: "EADBC8", width: 1 },
          rectRadius: 0.06,
        });
        slide.addText(
          [
            { text: clean(c.label).toUpperCase(), options: { fontSize: 10, bold: true, color: ACCENT, breakLine: true, charSpacing: 1 } },
            { text: clean(c.heading), options: { fontSize: 14, bold: true, color: INK, breakLine: true } },
            { text: clean(c.body), options: { fontSize: 11, color: MUTED } },
          ],
          { x: x + 0.18, y: y + 0.12, w: cw - 0.36, h: ch - 0.24, fontFace: "Calibri", valign: "top", margin: 0 },
        );
      });
      if (s.note) {
        slide.addText(clean(s.note), {
          x: M, y: 4.8, w: BODY_W, h: 0.4, fontSize: 11, italic: true, color: MUTED,
          fontFace: "Calibri",
        });
      }
      return;
    }

    if (s.kind === "addons") {
      const rows: string[][] = [["Module", "Included", "What it does", "Status"]];
      s.items.forEach((it) =>
        rows.push([clean(it.name), it.tier === "free" ? "Free" : "Paid", clean(it.summary), clean(it.status)]),
      );
      slide.addTable(rows, {
        x: M, y: 1.75, w: BODY_W, colW: [2.0, 0.9, 4.5, 1.4], fontSize: 10, fontFace: "Calibri",
        color: INK, border: { type: "solid", color: "EADBC8", pt: 1 },
        fill: { color: PAPER },
      });
      slide.addText(clean(s.note), {
        x: M, y: 4.85, w: BODY_W, h: 0.4, fontSize: 11, italic: true, color: MUTED, fontFace: "Calibri",
      });
      return;
    }

    if (s.kind === "pricing") {
      const rows: string[][] = [["Edition", "Price", "People", "Modules"]];
      s.rows.forEach((r) => rows.push([clean(r.name), clean(r.price), clean(r.seats), clean(r.addons)]));
      slide.addTable(rows, {
        x: M, y: 1.75, w: BODY_W, colW: [2.6, 2.2, 2.2, 1.8], fontSize: 10, fontFace: "Calibri",
        color: INK, border: { type: "solid", color: "EADBC8", pt: 1 }, fill: { color: PAPER },
      });
      slide.addText(clean(s.note), {
        x: M, y: 4.85, w: BODY_W, h: 0.4, fontSize: 11, italic: true, color: MUTED, fontFace: "Calibri",
      });
    }
  });

  const fileName = `${fileBase}.pptx`;
  await pptx.writeFile({ fileName });
  return fileName;
}
