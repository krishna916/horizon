import React from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { userApi } from '@/user/api'
import { HomeComponent } from '../home/HomeComponent'

void React

export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData({
        queryKey: ['me'],
        queryFn: async () => {
          const response = await userApi.getCurrentUser();
          return response.data;
        },
      });
    } catch (error) {
      throw redirect({
        to: '/login',
      });
    }
  },
  component: HomeComponent,
})
