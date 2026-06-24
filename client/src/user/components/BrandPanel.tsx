import { Sparkles, Check } from 'lucide-react';

export interface BrandPanelProps {
  variant?: 'light' | 'dark';
}

export function BrandPanel({ variant = 'light' }: BrandPanelProps) {
  const isDark = variant === 'dark';

  return (
    <div className={`flex flex-col justify-between h-full p-12 lg:p-20 text-left border-r ${
      isDark 
        ? 'bg-zinc-950 text-white border-zinc-900' 
        : 'bg-muted text-foreground border-border'
    }`}>
      <div className="flex flex-col gap-12 mt-12">
        <div className="flex items-center gap-2">
          {!isDark && <Sparkles className="size-6 text-foreground" />}
          <span className={`text-xl font-medium tracking-tight font-heading ${
            isDark ? 'text-white' : 'text-foreground'
          }`}>
            Horizon
          </span>
        </div>
        
        <div className="space-y-6">
          <h2 className={`text-2xl font-normal leading-tight max-w-sm ${
            isDark ? 'text-zinc-100' : 'text-foreground'
          }`}>
            A calm place for your work and thoughts.
          </h2>
          
          <ul className={`space-y-4 text-sm ${
            isDark ? 'text-zinc-400' : 'text-muted-foreground'
          }`}>
            {[
              'Capture quickly.',
              'Review intentionally.',
              'Focus on what matters.'
            ].map((text) => (
              <li key={text} className="flex items-center gap-3">
                <span className={`flex items-center justify-center size-5 rounded-full border ${
                  isDark 
                    ? 'border-zinc-800 bg-zinc-900' 
                    : 'border-border bg-background'
                }`}>
                  <Check className={`size-3 ${
                    isDark ? 'text-white' : 'text-foreground'
                  }`} />
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-auto">
        <div className={`w-12 h-px mb-4 ${
          isDark ? 'bg-zinc-800' : 'bg-border'
        }`}></div>
        <span className={`font-mono text-xs uppercase tracking-widest ${
          isDark ? 'text-zinc-500' : 'text-muted-foreground/60'
        }`}>
          {isDark ? 'VER. 2.4.0 © 2024' : 'Designed for deep work.'}
        </span>
      </div>
    </div>
  );
}
