import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  LoaderCircle,
  X,
  CircleAlert,
  ArrowLeft,
} from "lucide-react";
import { navigate } from "./api";
export function Link({
  to,
  children,
  className = "",
  ...rest
}: {
  to: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <a
      href={to}
      className={className}
      {...rest}
      onClick={(e) => {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          navigate(to);
        }
      }}
    >
      {children}
    </a>
  );
}
export function Button({
  children,
  onClick,
  disabled = false,
  kind = "",
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: string;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button
      type={type}
      className={`button ${kind}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const controlId = useId();
  const hintId = useId();
  let attached = false;
  function attach(node: ReactNode): ReactNode {
    return Children.map(node, (child) => {
      if (!isValidElement(child)) return child;
      const element = child as ReactElement<Record<string, any>>;
      if (
        !attached &&
        typeof element.type === "string" &&
        ["input", "textarea", "select"].includes(element.type)
      ) {
        attached = true;
        return cloneElement(element, {
          id: controlId,
          "aria-describedby": hint ? hintId : undefined,
        });
      }
      if (element.props.children)
        return cloneElement(element, {
          children: attach(element.props.children),
        });
      return child;
    });
  }
  return (
    <div className="field">
      <label htmlFor={controlId}>{label}</label>
      {attach(children)}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}
export function ErrorNotice({ error }: { error: string | null }) {
  return error ? (
    <div className="notice danger" role="alert">
      <CircleAlert size={17} />
      <span>{error}</span>
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={22} className="spin" /> Loading your workspace…
    </div>
  );
}
export function Empty({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-illustration">
        {icon || <ArrowUpRight size={26} />}
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </header>
  );
}
export function Panel({
  title,
  children,
  actions,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel-heading">
          <h2>{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
export function StepRow({
  number,
  title,
  description,
  done,
}: {
  number: string;
  title: string;
  description: string;
  done?: boolean;
}) {
  return (
    <div className="setup-row">
      <span className={`setup-number ${done ? "done" : ""}`}>
        {done ? <Check size={16} /> : number}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <ChevronRight size={16} />
    </div>
  );
}
export function Back({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="back">
      <ArrowLeft size={16} />
      {children}
    </Link>
  );
}
