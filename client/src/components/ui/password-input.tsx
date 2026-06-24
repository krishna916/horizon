import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from './input';
import { cn } from '@/lib/utils';

export function PasswordInput({ className, ...props }: ComponentProps<typeof Input>) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative w-full">
      <Input
        type={showPassword ? 'text' : 'password'}
        className={cn('pr-10', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShowPassword((prev) => !prev)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none transition-colors"
        aria-label={showPassword ? 'Hide password' : 'Show password'}
      >
        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
