import { createFileRoute } from '@tanstack/react-router';
import { RegisterForm } from '@/user/components/RegisterForm';
import { SplitLayout } from '@/user/components/SplitLayout';

export const Route = createFileRoute('/register')({
  component: RegisterPage,
});

function RegisterPage() {
  return (
    <SplitLayout>
      <RegisterForm />
    </SplitLayout>
  );
}
