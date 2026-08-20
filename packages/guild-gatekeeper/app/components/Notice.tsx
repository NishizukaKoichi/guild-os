import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

export function Notice({ kind = "info", title, children }: {
  kind?: "info" | "success" | "warning" | "error";
  title?: string;
  children: React.ReactNode;
}) {
  const Icon = kind === "success" ? CheckCircle2 : kind === "warning" ? TriangleAlert :
    kind === "error" ? AlertCircle : Info;
  return (
    <div
      className={`notice notice-${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <Icon size={18} aria-hidden="true" />
      <div>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
