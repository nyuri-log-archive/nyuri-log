import { z } from 'zod';
import { CATEGORIES } from './categories';

// バックアップ内の記録（完全なRecordItem）を検証するスキーマ。
// 将来の項目追加に備え passthrough で未知の項目も保持する。

const strDefault = z.string().catch('');

export const imageRefSchema = z.object({ id: z.string().min(1), caption: z.string().catch('') }).passthrough();

export const recordSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(CATEGORIES),
    title: strDefault,
    body: strDefault,
    madeDate: z.string().nullable().catch(null),
    createdAt: z.number(),
    updatedAt: z.number(),
    tags: z.array(z.string()).catch([]),
    status: strDefault,
    favorite: z.boolean().catch(false),
    urls: z.array(z.object({ label: strDefault, url: strDefault })).catch([]),
    images: z.array(imageRefSchema).catch([]),
    coverImageId: z.string().nullable().catch(null),
    fields: z.record(z.string(), z.string()).catch({}),
    source: z
      .object({
        type: z.enum(['github', 'json', 'backup']),
        githubRepoId: z.number().optional(),
        githubFullName: z.string().optional(),
        importedAt: z.number().optional(),
      })
      .passthrough()
      .nullable()
      .catch(null),
    links: z.array(z.object({ type: z.string(), targetId: z.string() })).catch([]),
    extra: z.record(z.string(), z.unknown()).catch({}),
    deletedAt: z.number().nullable().catch(null),
    rev: z.number().catch(1),
  })
  .passthrough();

export const historySchema = z.object({
  id: z.string().min(1),
  recordId: z.string().min(1),
  savedAt: z.number(),
  reason: z.enum(['edit', 'restore', 'category-change', 'import-merge']).catch('edit'),
  snapshot: recordSchema,
});

export const imageMetaSchema = z.object({
  id: z.string().min(1).regex(/^[A-Za-z0-9-]+$/),
  mime: z.string().regex(/^image\//),
  width: z.number(),
  height: z.number(),
  size: z.number(),
  thumbMime: z.string().regex(/^image\//),
  thumbSize: z.number(),
  hasOriginal: z.boolean(),
  originalMime: z.string().nullable(),
  originalSize: z.number(),
  originalName: z.string().catch(''),
  createdAt: z.number(),
  sha256: z.string().catch(''),
});
