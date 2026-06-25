import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-12 w-full rounded-md border border-border bg-muted px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 transition-all',
        'focus-visible:outline-none focus-visible:border-primary focus-visible:bg-white focus-visible:shadow-[0_0_0_4px_rgba(13,148,136,0.14)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 transition-all resize-y',
        'focus-visible:outline-none focus-visible:border-primary focus-visible:bg-white focus-visible:shadow-[0_0_0_4px_rgba(13,148,136,0.14)]',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
