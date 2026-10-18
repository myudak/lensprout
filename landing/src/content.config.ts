import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Blog posts. Comparisons must list their sources and the date the facts were checked, because
 * other products change their features and prices.
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string().max(70),
    description: z.string().min(50).max(160),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    kind: z.enum(['comparison', 'guide']),
    tags: z.array(z.string()).default([]),
    checkedOn: z.coerce.date().optional(),
    sources: z.array(z.object({ label: z.string(), url: z.url() })).default([]),
    related: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };
