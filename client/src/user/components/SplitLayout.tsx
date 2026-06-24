import * as React from 'react';
import { BrandPanel } from './BrandPanel';

export interface SplitLayoutProps {
  children: React.ReactNode;
  variant?: 'light' | 'dark';
}

export function SplitLayout({ children, variant = 'light' }: SplitLayoutProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 min-h-screen w-full bg-background">
      {/* Left panel - Brand presentation */}
      <div className="hidden lg:block h-full">
        <BrandPanel variant={variant} />
      </div>

      {/* Right panel - Registration / Login form */}
      <div className="flex items-center justify-center p-6 md:p-10 bg-background overflow-y-auto">
        <div className="w-full max-w-[420px] mx-auto flex flex-col justify-between min-h-[550px]">
          {children}
        </div>
      </div>
    </div>
  );
}
