import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// shadcn-svelte expects WithElementRef to make ref optional
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = Omit<T, 'ref'> & {
  ref?: U | null;
};
