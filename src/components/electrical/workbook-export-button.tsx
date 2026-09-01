// DOCX export for the electrician's field workbook. Pure presentation: it
// serializes the already-fetched workbook view, and writes nothing anywhere.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";
import {
  workbookFilename,
  type Workbook,
  type WorkbookSection,
} from "@/lib/electrical-workbook";

export interface WorkbookDiagramFigure {
  key: string;
  title: string;
  mermaid: string;
  svg?: string;
}

/** Rasterize a rendered Mermaid SVG so Word can embed it. */
async function svgToPng(
  svg: string,
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg load failed"));
      img.src = url;
    });
    const scale = 2;
    const w = img.naturalWidth || 900;
    const h = img.naturalHeight || 600;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1] ?? "";
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    // Fit inside the printable width of US Letter with 1" margins.
    const maxWidth = 624;
    const ratio = Math.min(1, maxWidth / w);
    return { data: bytes, width: Math.round(w * ratio), height: Math.round(h * ratio) };
  } catch {
    return null;
  }
}

export function WorkbookExportButton({
  workbook,
  diagrams,
}: {
  workbook: Workbook;
  diagrams: WorkbookDiagramFigure[];
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const docx = await import("docx");
      const {
        Document,
        Packer,
        Paragraph,
        TextRun,
        Table,
        TableRow,
        TableCell,
        ImageRun,
        HeadingLevel,
        AlignmentType,
        BorderStyle,
        WidthType,
        ShadingType,
        PageOrientation,
        Footer,
        PageNumber,
      } = docx;

      // Landscape US Letter: the entity tables are wide.
      const contentWidth = 15840 - 1440 - 1440;
      const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
      const borders = { top: border, bottom: border, left: border, right: border };
      const margins = { top: 60, bottom: 60, left: 110, right: 110 };

      const cell = (text: string, width: number, header: boolean) =>
        new TableCell({
          borders,
          margins,
          width: { size: width, type: WidthType.DXA },
          ...(header ? { shading: { fill: "F1E9DA", type: ShadingType.CLEAR } } : {}),
          children: [
            new Paragraph({
              children: [new TextRun({ text, bold: header, size: header ? 17 : 16 })],
            }),
          ],
        });

      const sectionBlocks = (section: WorkbookSection) => {
        const blocks: (typeof Paragraph.prototype | unknown)[] = [
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun(`${section.title} (${section.count})`)],
          }),
          new Paragraph({
            children: [new TextRun({ text: section.description, italics: true, size: 17 })],
          }),
        ];
        if (section.rows.length === 0) {
          blocks.push(
            new Paragraph({ children: [new TextRun({ text: "No records.", size: 18 })] }),
          );
          return blocks;
        }
        const columnCount = section.columns.length;
        const colWidth = Math.floor(contentWidth / columnCount);
        const widths = section.columns.map((_, i) =>
          i === columnCount - 1 ? contentWidth - colWidth * (columnCount - 1) : colWidth,
        );
        blocks.push(
          new Table({
            width: { size: contentWidth, type: WidthType.DXA },
            columnWidths: widths,
            rows: [
              new TableRow({
                tableHeader: true,
                children: section.columns.map((c, i) => cell(c.label, widths[i]!, true)),
              }),
              ...section.rows.map(
                (row) =>
                  new TableRow({
                    children: row.map((value, i) => cell(value, widths[i]!, false)),
                  }),
              ),
            ],
          }),
          new Paragraph({ children: [new TextRun("")] }),
        );
        return blocks;
      };

      const children: unknown[] = [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          children: [new TextRun(workbook.title)],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: `Field snapshot generated ${workbook.generated_at.replace("T", " ").slice(0, 19)} UTC · ${workbook.total_records} records`,
              italics: true,
              size: 18,
            }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "As-installed field record. The engineering spreadsheet (PremoFarmElectrical.ods) remains the release authority; stable IDs are permanent and must never be renamed or renumbered.",
              size: 18,
            }),
          ],
        }),
        new Paragraph({ children: [new TextRun("")] }),
      ];

      for (const section of workbook.sections) children.push(...sectionBlocks(section));

      if (diagrams.length) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Topology diagrams")],
          }),
        );
        for (const diagram of diagrams) {
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              children: [new TextRun(diagram.title)],
            }),
          );
          const png = diagram.svg ? await svgToPng(diagram.svg) : null;
          if (png) {
            children.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    type: "png",
                    data: png.data,
                    transformation: { width: png.width, height: png.height },
                    altText: {
                      title: diagram.title,
                      description: `${diagram.title} generated from FarmOps electrical records`,
                      name: diagram.title,
                    },
                  }),
                ],
              }),
            );
          } else {
            for (const line of diagram.mermaid.split("\n")) {
              children.push(
                new Paragraph({
                  children: [new TextRun({ text: line, font: "Consolas", size: 14 })],
                }),
              );
            }
          }
          children.push(new Paragraph({ children: [new TextRun("")] }));
        }
      }

      const doc = new Document({
        styles: {
          default: { document: { run: { font: "Arial", size: 20 } } },
          paragraphStyles: [
            {
              id: "Heading1",
              name: "Heading 1",
              basedOn: "Normal",
              next: "Normal",
              quickFormat: true,
              run: { size: 32, bold: true, font: "Arial" },
              paragraph: { spacing: { before: 240, after: 180 }, outlineLevel: 0 },
            },
            {
              id: "Heading2",
              name: "Heading 2",
              basedOn: "Normal",
              next: "Normal",
              quickFormat: true,
              run: { size: 26, bold: true, font: "Arial" },
              paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 },
            },
          ],
        },
        sections: [
          {
            properties: {
              page: {
                size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE },
                margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
              },
            },
            footers: {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({ text: "Page ", size: 16 }),
                      new TextRun({ children: [PageNumber.CURRENT], size: 16 }),
                    ],
                  }),
                ],
              }),
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            children: children as any,
          },
        ],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = workbookFilename(workbook.generated_at, "docx");
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Workbook downloaded");
    } catch (error) {
      toast.error(`Couldn't build the Word workbook: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={() => void download()} disabled={busy}>
      {busy ? (
        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
      ) : (
        <FileText className="h-4 w-4 mr-1.5" />
      )}
      Download DOCX
    </Button>
  );
}
