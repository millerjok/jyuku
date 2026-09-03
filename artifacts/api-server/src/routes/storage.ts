import { Readable } from 'stream';
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import express, { Router, type IRouter, type Request, type Response } from 'express';
import { ObjectNotFoundError, ObjectStorageService } from '../lib/objectStorage';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /storage/uploads/request-url
 *
 * Request an upload URL for a new object. Client sends JSON metadata (name,
 * size, contentType) — NOT the file bytes — then PUTs the file directly to
 * the returned URL (see the PUT route below).
 */
router.post('/storage/uploads/request-url', async (req: Request, res: Response): Promise<void> => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid required fields' });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({ uploadURL, objectPath }),
    );
  } catch (error) {
    req.log.error({ err: error }, 'Error generating upload URL');
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS — unconditionally public.
 */
router.get('/storage/public-objects/*filePath', async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join('/') : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, 'Error serving public object');
    res.status(500).json({ error: 'Failed to serve public object' });
  }
});

/**
 * PUT /storage/objects/uploads/:objectId
 *
 * Receive the raw bytes for an upload URL previously issued by
 * POST /storage/uploads/request-url. objectId must be a fresh UUID minted
 * by that endpoint, so an upload can only create a new object, never
 * overwrite an existing one.
 */
router.put(
  '/storage/objects/uploads/:objectId',
  express.raw({ type: '*/*', limit: '200mb' }),
  async (req: Request, res: Response): Promise<void> => {
    const rawObjectId = req.params.objectId;
    const objectId = Array.isArray(rawObjectId) ? rawObjectId[0] : rawObjectId;
    if (!objectId || !UUID_RE.test(objectId)) {
      res.status(400).json({ error: 'Invalid object id' });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Missing request body' });
      return;
    }
    try {
      const objectPath = `/objects/uploads/${objectId}`;
      const rawContentType = req.headers['content-type'];
      const contentType =
        (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType) ||
        'application/octet-stream';
      await objectStorageService.uploadObjectEntity(objectPath, req.body, contentType);
      res.status(200).json({ ok: true });
    } catch (error) {
      req.log.error({ err: error }, 'Error receiving upload');
      res.status(500).json({ error: 'Failed to store upload' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve uploaded object entities from PRIVATE_OBJECT_DIR.
 * Presentations are public-readable by default (no auth required).
 */
router.get('/storage/objects/*path', async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;
