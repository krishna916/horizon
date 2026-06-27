import { createFileRoute } from '@tanstack/react-router'
import { HomeComponent } from '../../home/HomeComponent'

export const Route = createFileRoute('/_authenticated/')({
  component: HomeComponent,
})
