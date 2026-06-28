import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRegisterUser } from '../hooks/useRegisterUser';
import { useNavigate, Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { SocialButton } from './SocialButton';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { Sparkles } from 'lucide-react';

const registerFormSchema = z
  .object({
    email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
    agreeTerms: z.boolean().refine((val) => val === true, {
      message: 'You must agree to the terms and conditions',
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterFormFields = z.infer<typeof registerFormSchema>;

export function RegisterForm() {
  const navigate = useNavigate();
  const { mutateAsync, isPending, error } = useRegisterUser();

  const form = useForm<RegisterFormFields>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { email: '', password: '', confirmPassword: '', agreeTerms: false },
  });

  const onSubmit = async (data: RegisterFormFields) => {
    try {
      await mutateAsync({
        email: data.email,
        password: data.password,
      });
      navigate({ to: '/' });
    } catch {
      // error handling is done via mutation error state
    }
  };

  return (
    <div className="flex flex-col justify-between h-full min-h-[550px] w-full">
      {/* Mobile Logo Header */}
      <div className="flex flex-col items-center gap-2 mb-8 lg:hidden">
        <Sparkles className="size-6 text-foreground" />
        <span className="text-xl font-medium tracking-tight font-heading">Horizon</span>
      </div>

      <div className="text-center lg:text-left mb-6">
        <h1 className="text-3xl font-medium tracking-tight text-foreground m-0">
          Create your account
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Create an account to start using Horizon.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 w-full">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-sm font-normal text-foreground">Email Address</FormLabel>
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
                  <PasswordInput placeholder="••••••••" {...field} />
                </FormControl>
                <FormMessage className="text-xs text-destructive mt-1 block" />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-sm font-normal text-foreground">
                  Confirm Password
                </FormLabel>
                <FormControl>
                  <PasswordInput placeholder="••••••••" {...field} />
                </FormControl>
                <FormMessage className="text-xs text-destructive mt-1 block" />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="agreeTerms"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md py-2">
                <FormControl>
                  <input
                    type="checkbox"
                    id="agreeTerms-checkbox"
                    checked={field.value}
                    onChange={(e) => field.onChange(e.target.checked)}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    className="size-4 rounded border-border text-primary focus:ring-ring focus:ring-offset-background cursor-pointer mt-0.5"
                  />
                </FormControl>
                <div className="space-y-1 leading-none text-left">
                  <label
                    htmlFor="agreeTerms-checkbox"
                    className="text-sm font-normal text-muted-foreground select-none cursor-pointer"
                  >
                    I agree to the{' '}
                    <a
                      href="/terms"
                      className="text-foreground hover:underline underline-offset-2 font-medium"
                    >
                      Terms of Service
                    </a>{' '}
                    and{' '}
                    <a
                      href="/privacy"
                      className="text-foreground hover:underline underline-offset-2 font-medium"
                    >
                      Privacy Policy
                    </a>
                    .
                  </label>
                  <FormMessage className="text-xs text-destructive mt-1 block" />
                </div>
              </FormItem>
            )}
          />

          {error && (
            <div
              className="text-xs text-destructive text-center p-3 rounded-md bg-destructive/10 border border-destructive/20"
              role="alert"
            >
              {error.response?.data?.title || 'Registration failed'}
            </div>
          )}

          <Button
            type="submit"
            disabled={isPending}
            className="w-full h-10 mt-2 font-medium bg-primary text-primary-foreground hover:bg-primary/95 transition-colors shadow-none cursor-pointer"
          >
            {isPending ? 'Registering…' : 'Create Account'}
          </Button>
        </form>
      </Form>

      <div className="w-full">
        <div className="relative flex items-center justify-center my-6">
          <span className="absolute inset-x-0 h-px bg-border"></span>
          <span className="relative bg-background px-3 text-xs text-muted-foreground/60 uppercase tracking-widest font-mono">
            or
          </span>
        </div>

        <SocialButton provider="google">Continue with Google</SocialButton>

        <p className="text-sm text-center text-muted-foreground mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-foreground hover:underline font-semibold">
            Sign In
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
