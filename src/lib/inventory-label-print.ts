import QRCode from "qrcode";
import {
  LABEL_FORMATS,
  LABEL_FORMAT_LIST,
  type LabelFormat,
} from "@/components/electrical/panel-qr-label";
import type { KitRackBuildout } from "@/lib/kit-rack-index.functions";

const CODE39: Record<string, string> = {
  "0":"nnnwwnwnn","1":"wnnwnnnnw","2":"nnwwnnnnw","3":"wnwwnnnnn","4":"nnnwwnnnw",
  "5":"wnnwwnnnn","6":"nnwwwnnnn","7":"nnnwnnwnw","8":"wnnwnnwnn","9":"nnwwnnwnn",
  A:"wnnnnwnnw",B:"nnwnnwnnw",C:"wnwnnwnnn",D:"nnnnwwnnw",E:"wnnnwwnnn",
  F:"nnwnwwnnn",G:"nnnnnwwnw",H:"wnnnnwwnn",I:"nnwnnwwnn",J:"nnnnwwwnn",
  K:"wnnnnnnww",L:"nnwnnnnww",M:"wnwnnnnwn",N:"nnnnwnnww",O:"wnnnwnnwn",
  P:"nnwnwnnwn",Q:"nnnnnnwww",R:"wnnnnnwwn",S:"nnwnnnwwn",T:"nnnnwnwwn",
  U:"wwnnnnnnw",V:"nwwnnnnnw",W:"wwwnnnnnn",X:"nwnnwnnnw",Y:"wwnnwnnnn",
  Z:"nwwnwnnnn","-":"nwnnnnwnw",".":"wwnnnnwnn"," ":"nwwnnnwnn",
  "$":"nwnwnwnnn","/":"nwnwnnnwn","+":"nwnnnwnwn","%":"nnnwnwnwn","*":"nwnnwnwnn",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;",
  })[c]!);
}

function code39Svg(raw: string): string {
  const value = raw.toUpperCase().replace(/[^0-9A-Z. $\/+%\-]/g, "-").slice(0, 48);
  const encoded = `*${value}*`;
  const narrow = 2;
  const wide = 5;
  const gap = narrow;
  let x = 8;
  const bars: string[] = [];
  for (const char of encoded) {
    const pattern = CODE39[char] ?? CODE39["-"];
    for (let i = 0; i < pattern.length; i += 1) {
      const width = pattern[i] === "w" ? wide : narrow;
      if (i % 2 === 0) bars.push(`<rect x="${x}" y="2" width="${width}" height="42"/>`);
      x += width;
    }
    x += gap;
  }
  return `<svg viewBox="0 0 ${x + 8} 58" role="img" aria-label="Barcode ${escapeHtml(value)}" xmlns="http://www.w3.org/2000/svg"><g fill="#000">${bars.join("")}</g><text x="${(x + 8) / 2}" y="55" text-anchor="middle" font-family="monospace" font-size="9">${escapeHtml(value)}</text></svg>`;
}

function kindLabel(buildout: KitRackBuildout): string {
  if (buildout.rack) return "RACK";
  return buildout.containerKind === "bag" ? "BAG" : "KIT";
}

export async function printContainerLabelPair(buildout: KitRackBuildout): Promise<void> {
  const choice = window.prompt(
    "Label format:\n" + LABEL_FORMAT_LIST.map((f) => `${f.id} — ${f.name}`).join("\n"),
    "letter-4x2",
  );
  if (choice == null) return;
  if (!(choice in LABEL_FORMATS)) {
    throw new Error("Unknown label format. Choose one of the listed format IDs.");
  }
  const format = choice as LabelFormat;
  const spec = LABEL_FORMATS[format];
  const popup = window.open("", "_blank", "width=900,height=760");
  if (!popup) throw new Error("Allow pop-ups to print inventory labels.");

  const objectUrl = `${window.location.origin}/kits-racks/${buildout.kitId}`;
  const qr = spec.short ? "" : await QRCode.toString(objectUrl, { type:"svg", margin:1, width:spec.qrPx * 2 });
  const includeItemQr = !spec.short && spec.id !== "letter-2x5" && buildout.parts.length <= 8;
  const partQrs = includeItemQr
    ? await Promise.all(buildout.parts.map((part) =>
        QRCode.toString(`${window.location.origin}/inventory?item=${part.componentItemId}`, {
          type:"svg", margin:1, width:96,
        }),
      ))
    : [];

  const marginIn = spec.id === "label-7676" ? 0.08 : 0.25;
  const cellW = (spec.page.widthIn - marginIn * 2) / spec.cols;
  const cellH = (spec.page.heightIn - marginIn * 2) / spec.rows;
  const stableId = buildout.sku || buildout.rack?.stableId || buildout.kitId;
  const parts = buildout.parts.map((part, index) => `
    <li class="${includeItemQr ? "with-qr" : ""}">
      ${includeItemQr ? `<span class="item-qr">${partQrs[index]}</span>` : ""}
      <span><b>${escapeHtml(String(part.quantity))}${part.unit ? ` ${escapeHtml(part.unit)}` : ""}</b>
      ${escapeHtml(part.name)}</span>
    </li>`).join("");

  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(buildout.kitName)} labels</title>
<style>
*{box-sizing:border-box} body{font-family:Arial,sans-serif;margin:24px;color:#111}
.toolbar{margin-bottom:16px}.sheet{display:grid;grid-template-columns:repeat(${spec.cols},minmax(0,1fr));gap:8px}
.label{border:1px solid #777;border-radius:8px;padding:10px;overflow:hidden;min-height:170px}
.identity{display:flex;flex-direction:column;align-items:center;text-align:center}
.identity .qr{width:min(42%,150px)}.qr svg,.item-qr svg,.barcode svg{display:block;width:100%;height:auto}
h1{font-size:16px;line-height:1.1;margin:4px 0}.kind{font-size:10px;font-weight:700;letter-spacing:.12em}
.home{font-size:11px;margin-top:3px}.barcode{width:100%;max-height:70px}.contents h2{font-size:13px;margin:0 0 4px}
.contents ul{list-style:none;padding:0;margin:0;font-size:9px;columns:${spec.id === "letter-4x2" ? 2 : 1};column-gap:8px}
.contents li{break-inside:avoid;margin:0 0 3px}.contents li.with-qr{display:flex;align-items:center;gap:3px}
.item-qr{display:inline-block;width:30px;flex:0 0 30px}.empty{font-size:10px;color:#555}
.short{border-radius:2px;padding:4px;min-height:0}.short h1{font-size:10px;text-align:left}
.short .barcode{height:28px}.short .home,.short .kind{font-size:7px}.short.contents ul{font-size:7px;white-space:nowrap;overflow:hidden}
@media print{
 @page{size:${spec.page.widthIn}in ${spec.page.heightIn}in;margin:${marginIn}in}
 body{margin:0}.toolbar{display:none}.sheet{display:grid;grid-template-columns:repeat(${spec.cols},${cellW}in);grid-auto-rows:${cellH}in;gap:0}
 .label{width:${cellW}in;height:${cellH}in;border:0;border-radius:0;break-inside:avoid;page-break-inside:avoid}
}
</style></head><body><div class="toolbar"><button onclick="window.print()">Print paired labels</button>
<p>Format: ${escapeHtml(spec.name)}. Print at 100% with browser headers and footers disabled.</p></div>
<main class="sheet">
<section class="label identity ${spec.short ? "short" : ""}">
 ${qr ? `<div class="qr">${qr}</div>` : ""}
 <div class="kind">LABEL A · ${kindLabel(buildout)}</div>
 <h1>${escapeHtml(buildout.rack?.stableId || buildout.kitName)}</h1>
 <div class="barcode">${code39Svg(stableId)}</div>
 <div class="home"><b>Home:</b> ${escapeHtml(buildout.location || "Not recorded")}</div>
</section>
<section class="label contents ${spec.short ? "short" : ""}">
 <h2>LABEL B · ${escapeHtml(buildout.kitName)} contents</h2>
 ${parts ? `<ul>${parts}</ul>` : '<p class="empty">No contents recorded.</p>'}
</section>
</main></body></html>`);
  popup.document.close();
}
