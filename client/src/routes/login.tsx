import { LoginForm } from '@/user/components/LoginForm';
import { SplitLayout } from '@/user/components/SplitLayout';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  return (
    <SplitLayout variant="dark">
      <LoginForm />
    </SplitLayout>
  );
}
