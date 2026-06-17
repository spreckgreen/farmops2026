import { useRef, useState } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Upload } from "lucide-react";
import { rowsToCsv, downloadCsv } from "@/lib/csv";
import { toast } from "sonner";

export type CsvColumn<T extends Record<string, unknown> = Record<string, unknown>> = {
  key: keyof T & string;
  label: string;
};

export interface CsvToolbarProps<T extends Record<string, unknown>> {
  filename: string;
  columns: ReadonlyArray<CsvColumn<T>>;
  rows: T[];
  onImport?: (rows: Array<Record<string, string>>) => void | Promise<void>;
  importing?: boolean;
  disabled?: boolean;
  exportLabel?: string;
  importLabel?: string;
  size?: "sm" | "default";
}

export function CsvToolbar<T extends Record<string, unknown>>({
  filename,
  columns,
  rows,
  onImport,
  importing,
  disabled,
  exportLabel = "Export CSV",
  importLabel = "Import CSV",
  size = "sm",
}: CsvToolbarProps<T>) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [parsing, setParsing] = useState(false);

  function handleExport() {
    const csv = rowsToCsv(rows as never, columns as never);
    downloadCsv(filename, csv);
  }

  function handleFile(file: File) {
    if (!onImport) return;
    setParsing(true);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (res) => {
        try {
          if (res.errors.length) {
            toast.error(`Parse error: ${res.errors[0].message}`);
            return;
          }
          await onImport(res.data);
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setParsing(false);
        }
      },
      error: (err) => {
        toast.error(`Parse error: ${err.message}`);
        setParsing(false);
      },
    });
  }

  const busy = parsing || !!importing;

  return (
    <div className="flex items-center gap-2">
      {onImport && (
        <>
          <Button
            variant="outline"
            size={size}
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {importLabel}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.currentTarget.value = "";
            }}
          />
        </>
      )}
      <Button
        variant="outline"
        size={size}
        onClick={handleExport}
        disabled={disabled || rows.length === 0}
      >
        <Download className="h-4 w-4 mr-2" />
        {exportLabel}
      </Button>
    </div>
  );
}
