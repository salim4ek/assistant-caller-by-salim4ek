import { cn } from '@/lib/utils'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const sizes = {
  sm: 'h-10 w-10',
  md: 'h-12 w-12',
  lg: 'h-16 w-16',
  xl: 'h-24 w-24',
}

export function Logo({ size = 'md', className }: LogoProps) {
  return (
    <img
      src="/icon-512.png"
      alt="NN+"
      className={cn('inline-block rounded-xl object-contain', sizes[size], className)}
    />
  )
}
