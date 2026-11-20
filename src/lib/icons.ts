import {
  ArrowRightLeft, Bot, Braces, Code2, Combine, Copy, FileImage, FileOutput, FilePenLine, FilePlus2,
  FileText, FileType, Image, ImagePlus, Images, LayoutGrid, ListChecks, ListOrdered, LockKeyhole,
  LockKeyholeOpen, Minimize2, PanelsTopLeft, PenLine, PenTool, Presentation, Repeat2, RotateCw,
  ScanLine, ScanSearch, ScanText, Scissors, Sheet, ShieldAlert, ShieldCheck, Sparkles, Stamp, Table2,
  Trash2, WandSparkles, Workflow, Wrench, Fingerprint, GitCompareArrows,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const iconByName: Record<string, LucideIcon> = {
  ArrowRightLeft, Bot, Braces, Code2, Combine, Copy, FileImage, FileOutput, FilePenLine, FilePlus2,
  FileText, FileType, Image, ImagePlus, Images, LayoutGrid, ListChecks, ListOrdered, LockKeyhole,
  LockKeyholeOpen, Minimize2, PanelsTopLeft, PenLine, PenTool, Presentation, Repeat2, RotateCw,
  ScanLine, ScanSearch, ScanText, Scissors, Sheet, ShieldAlert, ShieldCheck, Sparkles, Stamp, Table2,
  Trash2, WandSparkles, Workflow, Wrench, Fingerprint, GitCompareArrows,
};

export function iconFor(name: string): LucideIcon {
  return iconByName[name] ?? FileText;
}
