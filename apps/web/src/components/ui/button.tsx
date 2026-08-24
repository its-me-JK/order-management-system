import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-11 px-5',
        icon: 'size-10',
        lg: 'h-12 px-6 text-base',
        sm: 'h-9 px-3 text-xs',
      },
      variant: {
        default: 'bg-slate-950 text-white shadow-sm hover:bg-slate-800',
        destructive: 'bg-rose-600 text-white hover:bg-rose-700',
        ghost: 'text-slate-700 hover:bg-slate-100 hover:text-slate-950',
        outline:
          'border border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50',
        secondary: 'bg-amber-300 text-slate-950 hover:bg-amber-400',
      },
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size, type = 'button', variant, ...props }, reference) => (
    <button
      ref={reference}
      className={cn(buttonVariants({ className, size, variant }))}
      type={type}
      {...props}
    />
  ),
);

Button.displayName = 'Button';

export { buttonVariants };
