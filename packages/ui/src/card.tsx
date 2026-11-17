import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.ts';

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode;
  description?: ReactNode;
};

export function Card({ title, description, className, children, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={cn('rounded-[var(--radius)] border border-border bg-surface-2 p-5', className)}
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      {title ? <h2 className="text-base font-semibold text-text">{title}</h2> : null}
      {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
      {children}
    </div>
  );
}
