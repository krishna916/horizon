import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '../schemas';
import type { LoginRequest } from '../types';
import { useLoginUser } from '../hooks/useLoginUser';
import { useNavigate, Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';

type LoginFormFields = LoginRequest & { rememberMe?: boolean };

export function LoginForm() {
  const navigate = useNavigate();
  const { mutateAsync, isPending, error } = useLoginUser();

  const form = useForm<LoginFormFields>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  const onSubmit = async (data: LoginFormFields) => {
    try {
      await mutateAsync({
        email: data.email,
        password: data.password,
      });
      navigate({ to: '/' });
    } catch {
      // Handled by query mutation error state
    }
  };

  return (
    <div className="flex flex-col justify-between h-full min-h-[550px] w-full">
      {/* Mobile Logo Header */}
      <div className="flex flex-col items-center gap-2 mb-8 lg:hidden">
        <span className="text-xl font-medium tracking-tight font-heading">Horizon</span>
      </div>

      <div className="text-center lg:text-left mb-6">
        <h1 className="text-3xl font-medium tracking-tight text-foreground m-0">Welcome back</h1>
        <p className="text-sm text-muted-foreground mt-2">Sign in to continue.</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 w-full">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-sm font-normal text-foreground">Email address</FormLabel>
                <FormControl>
                  <Input placeholder="name@example.com" {...field} />
                </FormControl>
                <FormMessage className="text-xs text-destructive mt-1 block" />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-sm font-normal text-foreground">Password</FormLabel>
                <FormControl>
                  <PasswordInput placeholder="Enter your password" {...field} />
                </FormControl>
                <FormMessage className="text-xs text-destructive mt-1 block" />
              </FormItem>
            )}
          />

          <div className="flex items-center justify-between py-2">
            <FormField
              control={form.control}
              name="rememberMe"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <input
                      type="checkbox"
                      id="rememberMe-checkbox"
                      checked={field.value || false}
                      onChange={(e) => field.onChange(e.target.checked)}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      className="size-4 rounded border-border text-primary focus:ring-ring focus:ring-offset-background cursor-pointer"
                    />
                  </FormControl>
                  <label
                    htmlFor="rememberMe-checkbox"
                    className="text-sm font-normal text-muted-foreground select-none cursor-pointer"
                  >
                    Remember me
                  </label>
                </FormItem>
              )}
            />

            <button
              type="button"
              className="text-sm font-normal text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
            >
              Forgot password?
            </button>
          </div>

          {error && (
            <div
              className="text-xs text-destructive text-center p-3 rounded-md bg-destructive/10 border border-destructive/20"
              role="alert"
            >
              {error.response?.data?.title || 'Invalid email or password'}
            </div>
          )}

          <Button
            type="submit"
            disabled={isPending}
            className="w-full h-10 mt-2 font-medium bg-primary text-primary-foreground hover:bg-primary/95 transition-colors shadow-none cursor-pointer"
          >
            {isPending ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>
      </Form>

      <div className="w-full">
        <div className="h-px bg-border my-6"></div>

        <p className="text-sm text-center text-muted-foreground">
          Don't have an account?{' '}
          <Link to="/register" className="text-foreground hover:underline font-semibold">
            Create Account
          </Link>
        </p>
      </div>

      {/* Footer Links */}
      <div className="flex items-center justify-center gap-8 mt-12 mb-2 font-mono text-[10px] text-muted-foreground/50 tracking-widest uppercase">
        <a href="/privacy" className="hover:text-foreground transition-colors">
          Privacy
        </a>
        <a href="/terms" className="hover:text-foreground transition-colors">
          Terms
        </a>
        <a href="/help" className="hover:text-foreground transition-colors">
          Help
        </a>
      </div>
    </div>
  );
}
