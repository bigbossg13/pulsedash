import { Suspense } from 'react'
import type { Metadata } from 'next'
import DisplayRoute from '@/components/DisplayClient'

export const metadata: Metadata = {
  title: 'Pit display',
}

export default function DisplayPage() {
  return (
    <Suspense fallback={<p style={{ padding: '2rem' }}>Loading display…</p>}>
      <DisplayRoute />
    </Suspense>
  )
}
