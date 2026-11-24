import type { ReactNode } from "react";

interface Props {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  testId?: string;
}

/** Centered message that fills the space it is given. */
export function EmptyState({ icon, title, children, actions, testId }: Props) {
  return (
    <div className="empty" data-testid={testId}>
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {actions ? <div className="empty-actions">{actions}</div> : null}
    </div>
  );
}
