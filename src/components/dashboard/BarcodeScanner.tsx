import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScanLine } from "lucide-react";

interface BarcodeScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (code: string) => void;
}

const BarcodeScanner = ({ open, onOpenChange, onScan }: BarcodeScannerProps) => {
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = "barcode-reader";

  const stopScanner = () => {
    if (scannerRef.current?.isScanning) {
      scannerRef.current.stop().catch(() => {});
    }
    scannerRef.current = null;
  };

  useEffect(() => {
    if (!open) return;
    const startScanner = async () => {
      try {
        setError(null);
        // Camera scanning is browser-only. Loading it on demand keeps the
        // ZXing/camera graph out of the Nitro server build.
        const { Html5Qrcode } = await import("html5-qrcode");
        const scanner = new Html5Qrcode(containerId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 150 } },
          (decodedText) => {
            onScan(decodedText);
            stopScanner();
            onOpenChange(false);
          },
          () => {},
        );
      } catch {
        setError("Camera access denied or not available. You can type the barcode manually.");
      }
    };
    const timer = setTimeout(startScanner, 300);
    return () => {
      clearTimeout(timer);
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) stopScanner();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <ScanLine className="h-5 w-5" /> Scan Barcode
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div
            id={containerId}
            className="w-full rounded-lg overflow-hidden bg-muted min-h-[250px]"
          />
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <p className="text-xs text-muted-foreground text-center">
            Point your camera at a barcode or QR code
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BarcodeScanner;
