import { AlertCircle, CheckCircle2, Info } from "lucide-react";

export function Notice({ kind = "info", title, children }: {
  kind?: "info" | "success" | "error";
  title?: string;
  children: React.ReactNode;
}) {
  const Icon = kind === "success" ? CheckCircle2 : kind === "error" ? AlertCircle : Info;
  return (
    <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <div>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
