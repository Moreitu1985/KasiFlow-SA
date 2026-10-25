import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Up to two initials for an avatar: "Ayanda (fictional)" → "A", "Thato's Barber Studio" → "TB". */
export function initialsOf(name: string): string {
  return name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}
