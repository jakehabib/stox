import { Suspense } from "react";
import StockScanner from "@/components/StockScanner";

export const metadata = { title: "Scanner · ClaudeStocks" };

export default function ScannerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Stock Scanner</h1>
        <p className="text-gray-400 mt-2">
          Enter a ticker and pick focus areas. Claude analyzes real Polygon.io
          data and returns a structured signal.
        </p>
      </div>
      <Suspense fallback={<div className="text-gray-400">Loading…</div>}>
        <StockScanner />
      </Suspense>
    </div>
  );
}
