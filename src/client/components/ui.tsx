import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Loader2, Inbox, CircleAlert } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { clsx } from "clsx";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon";

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      className={clsx(
        "btn",
        {
          "btn-primary": variant === "primary",
          "btn-secondary": variant === "secondary",
          "btn-ghost": variant === "ghost",
          "btn-danger": variant === "danger",
          "btn-icon": size === "icon",
        },
        size === "sm" && "min-h-[29px] px-2.5 text-[11px]",
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx("input", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx("select", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx("textarea", className)} {...props} />;
}

export type Tone = "ok" | "warn" | "bad" | "info" | "dim";

export function Badge({
  tone = "dim",
  dot = false,
  children,
  className,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "badge",
        {
          "badge-ok": tone === "ok",
          "badge-warn": tone === "warn",
          "badge-bad": tone === "bad",
          "badge-info": tone === "info",
          "badge-dim": tone === "dim",
        },
        className,
      )}
    >
      {dot ? <span className="badge-dot" /> : null}
      {children}
    </span>
  );
}

export function Panel({
  title,
  eyebrow,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("panel", className)}>
      {(title || action) && (
        <header className="panel-header">
          <div className="panel-title">
            {eyebrow ? <span className="mono-label">{eyebrow}</span> : null}
            {title}
          </div>
          {action}
        </header>
      )}
      <div className={clsx("panel-body", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Field({
  label,
  help,
  children,
  className,
}: {
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("field-label", className)}>
      {label}
      {children}
      {help ? <span className="field-help">{help}</span> : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors",
        checked ? "border-accent bg-accent" : "border-line-strong bg-bg",
        disabled && "opacity-40",
      )}
    >
      <span
        className={clsx(
          "block h-[14px] w-[14px] rounded-full transition-transform",
          checked ? "translate-x-[19px] bg-bg" : "translate-x-[3px] bg-muted",
        )}
      />
    </button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton h-4 w-full", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-line bg-bg text-dim">
        {icon ?? <Inbox size={20} />}
      </div>
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function LoadError({
  message,
  onRetry,
  title = "Could not load this surface",
}: {
  message: string;
  onRetry: () => void;
  title?: string;
}) {
  return (
    <div role="alert" className="panel border-bad/30 bg-bad/5 p-5">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-bad">{message}</p>
      <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function ErrorNotice({ message, issues }: { message: string; issues?: string[] }) {
  return (
    <div className="flex items-start gap-2 rounded-sm border border-bad/30 bg-bad/5 px-3 py-2.5 text-xs text-bad">
      <CircleAlert size={15} className="mt-0.5 shrink-0" />
      <div>
        <p>{message}</p>
        {issues && issues.length > 0 ? (
          <ul className="mt-1 list-disc pl-4 text-[11px] text-bad/80">
            {issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className={clsx("dialog-content", wide && "dialog-content-wide")}>
          <div className="dialog-header">
            <div>
              <DialogPrimitive.Title className="text-base font-bold tracking-tight text-ink">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close className="btn btn-ghost btn-icon" aria-label="Close">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>
          <div className="dialog-body">{children}</div>
          {footer ? <div className="dialog-footer">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  danger = false,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-xs text-muted">This action takes effect immediately.</div>
    </Dialog>
  );
}
