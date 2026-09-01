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

export function WorkbookExportButton({
  workbook,
  tidy,
}: {
  workbook: Workbook;
  tidy?: boolean;
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
      a.download = workbookFilename(workbook.generated_at, tidy ? "tidy.docx" : "docx");
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
      {tidy ? "Download tidy DOCX" : "Download DOCX"}
    </Button>
  );
}
