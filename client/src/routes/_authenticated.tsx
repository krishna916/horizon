import { createFileRoute, redirect } from '@tanstack/react-router'
import { userApi } from '@/user/api'
import { AppShell } from '@/app/layout/AppShell'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData({
        queryKey: ['me'],
        queryFn: async () => {
          const response = await userApi.getCurrentUser()
          return response.data
        },
      })
    } catch (error) {
      throw redirect({
        to: '/login',
      })
    }
  },
  component: AppShell,
})
