import type { ReactNode } from "react";
import { cn } from "./cn";

export type NoticeTone = "info" | "success" | "warning" | "error";

const TONES: Record<NoticeTone, string> = {
  info: "border-accent/30 bg-accent/5 text-ink",
  success: "border-success/30 bg-success/5 text-ink",
  warning: "border-amber-400/50 bg-amber-50 text-ink",
  error: "border-danger/30 bg-danger/5 text-danger",
};

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-4 py-3 text-sm", TONES[tone], className)}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? "mt-1" : undefined}>{children}</div>}
    </div>
  );
}
