import { lazy, Suspense, type ComponentProps } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

const Inner = lazy(() => import('./LeafletMap'))

/** The map, loaded only when a screen shows one (Leaflet stays out of the main bundle). */
export function LazyMap(props: ComponentProps<typeof Inner>) {
  return (
    <Suspense
      fallback={
        <div style={{ height: props.height ?? 320 }} className={props.className}>
          <Skeleton className="size-full rounded-xl" />
        </div>
      }
    >
      <Inner {...props} />
    </Suspense>
  )
}
