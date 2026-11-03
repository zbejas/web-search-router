import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import type { Toast } from "../hooks/useToast";
import { useToast } from "../hooks/useToast";

export function ToastContainer({ toasts }: { toasts: Toast[] }) {
  const { dismiss } = useToast();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast pointer-events-auto" role="status">
          <div
            className={
              toast.tone === "success"
                ? "status-ok mt-0.5"
                : toast.tone === "error"
                  ? "status-bad mt-0.5"
                  : "status-warn mt-0.5"
            }
          >
            {toast.tone === "success" ? (
              <CheckCircle2 size={16} />
            ) : toast.tone === "error" ? (
              <CircleAlert size={16} />
            ) : (
              <Info size={16} />
            )}
          </div>
          <p className="flex-1 text-xs leading-relaxed text-ink">{toast.message}</p>
          <button
            className="text-dim transition-colors hover:text-ink"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
