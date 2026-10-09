import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@renderer/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: ReactNode
  loading?: boolean
}

/** Button looks from the glass design system (see index.css). */
const variants: Record<Variant, string> = {
  primary: 'btn-burgundy',
  secondary: 'btn-glass text-fg',
  ghost: 'border-transparent bg-transparent text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'border-transparent bg-transparent text-danger hover:bg-danger-soft'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'motion-press inline-flex items-center justify-center gap-1.5 rounded-[10px] border font-medium whitespace-nowrap select-none',
        'disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variants[variant],
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
})

const field = 'glass-field rounded-[10px] text-sm text-fg placeholder:text-muted/80'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return <input className={cn(field, 'h-9 w-full px-3', className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  return <textarea className={cn(field, 'w-full resize-none px-3 py-2', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  return (
    <select className={cn(field, 'h-9 cursor-pointer px-2.5', className)} {...rest}>
      {children}
    </select>
  )
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'accent' | 'info' | 'warn' | 'danger'; children: ReactNode; className?: string }): ReactNode {
  const tones = {
    neutral: 'bg-white/60 text-muted ring-1 ring-line/80',
    accent: 'bg-accent-soft text-accent ring-1 ring-rose/30',
    info: 'bg-info-soft text-info',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger'
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', tones[tone], className)}>
      {children}
    </span>
  )
}

export function PanelHeader({ title, icon, children }: { title: string; icon?: ReactNode; children?: ReactNode }): ReactNode {
  return (
    <div className="glass-header flex h-12 shrink-0 items-center gap-2 rounded-t-[17px] px-4">
      {icon && <span className="text-rose">{icon}</span>}
      <h2 className="text-sm font-semibold tracking-[-0.005em]">{title}</h2>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }): ReactNode {
  return (
    <div className="anim-fade-in flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      {icon && <div className="mb-1 text-rose/70">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  )
}

export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <section className="glass-panel p-5">
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}
