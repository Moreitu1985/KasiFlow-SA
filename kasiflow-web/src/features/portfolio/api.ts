import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { PortfolioPhotoDto, PortfolioUpdateInput } from '@/types/customer'

/** A barber's portfolio. The barber manages their own; managers manage everyone's (the API checks). */
export function usePortfolio(staffId: string | null | undefined) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('team', 'portfolio', staffId),
    queryFn: () => api.get<PortfolioPhotoDto[]>(`/api/team/${staffId}/portfolio`),
    enabled: useBizReady() && !!staffId,
  })
}

export interface UploadPhotoInput {
  file: File
  caption?: string
  serviceId?: string
  consentConfirmed: boolean
  isPublic: boolean
}

export function useUploadPhoto(staffId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: UploadPhotoInput) => {
      const form = new FormData()
      form.append('file', input.file)
      if (input.caption?.trim()) form.append('caption', input.caption.trim())
      if (input.serviceId) form.append('serviceId', input.serviceId)
      form.append('consentConfirmed', input.consentConfirmed ? 'true' : 'false')
      form.append('isPublic', input.isPublic ? 'true' : 'false')
      return api.upload<PortfolioPhotoDto>(`/api/team/${staffId}/portfolio`, form)
    },
    onSuccess: () => invalidate(['team', 'workspace']),
  })
}

export function useUpdatePhoto(staffId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PortfolioUpdateInput }) => api.put<PortfolioPhotoDto>(`/api/team/${staffId}/portfolio/${id}`, input),
    onSuccess: () => invalidate(['team']),
  })
}

export function useDeletePhoto(staffId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/team/${staffId}/portfolio/${id}`),
    onSuccess: () => invalidate(['team', 'workspace']),
  })
}

/**
 * Portfolio files need the bearer token and X-Business-Id, so an <img src> cannot load them directly. Fetch the
 * file as a blob and show it through an object URL, which is revoked when the image unmounts or changes.
 */
export function usePortfolioImage(path: string | null) {
  const key = useBizKey()
  const q = useQuery({
    queryKey: key('team', 'portfolio-file', path),
    queryFn: () => api.blob(path!),
    enabled: useBizReady() && !!path,
    staleTime: 5 * 60_000,
    retry: 1,
  })
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!q.data) return
    const url = URL.createObjectURL(q.data)
    setSrc(url)
    return () => {
      URL.revokeObjectURL(url)
      setSrc(null)
    }
  }, [q.data])
  return { src, isLoading: q.isLoading, isError: q.isError }
}
