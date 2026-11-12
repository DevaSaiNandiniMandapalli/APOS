"use client";

import WatermarkTool from "./pdf-tools/watermark-tool";
import PageNumberTool from "./pdf-tools/page-number-tool";

export default function PdfMarking({ operation }: { operation: "watermark" | "page-number" }) {
  return operation === "watermark" ? <WatermarkTool /> : <PageNumberTool />;
}
