import { randomUUID } from 'crypto';
import fs from 'fs';
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import path from 'path';

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';

// Files are stored on local disk instead of a cloud bucket, so this app has
// no external storage account to provision. Point OBJECT_STORAGE_DIR at a
// persistent volume in production (an ephemeral disk loses uploads on
// restart/redeploy) — render.yaml sets this to the mounted disk path.
const STORAGE_ROOT = path.resolve(process.env.OBJECT_STORAGE_DIR || '.data/objects');

const METADATA_SUFFIX = '.meta.json';

interface FileMetadata {
  contentType?: string;
  metadata?: Record<string, string>;
  size?: number;
}

function resolveStoragePath(relativePath: string): string {
  const resolved = path.resolve(STORAGE_ROOT, relativePath);
  if (resolved !== STORAGE_ROOT && !resolved.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error('Invalid object path');
  }
  return resolved;
}

/**
 * A local-disk stand-in for a GCS `File` handle, implementing just the
 * subset of the API this codebase actually calls.
 */
export class LocalObjectFile {
  constructor(public readonly name: string) {}

  private get diskPath(): string {
    return resolveStoragePath(this.name);
  }

  private get metaPath(): string {
    return `${this.diskPath}${METADATA_SUFFIX}`;
  }

  async exists(): Promise<[boolean]> {
    try {
      await stat(this.diskPath);
      return [true];
    } catch {
      return [false];
    }
  }

  async getMetadata(): Promise<[FileMetadata]> {
    const stats = await stat(this.diskPath);
    let saved: FileMetadata = {};
    try {
      saved = JSON.parse(await readFile(this.metaPath, 'utf-8'));
    } catch {
      // No sidecar metadata file yet.
    }
    return [{ ...saved, size: stats.size }];
  }

  async setMetadata(update: { metadata: Record<string, string> }): Promise<void> {
    const [current] = await this.getMetadata().catch(() => [{} as FileMetadata]);
    const merged: FileMetadata = {
      ...current,
      metadata: { ...current.metadata, ...update.metadata },
    };
    await writeFile(this.metaPath, JSON.stringify(merged));
  }

  createReadStream(): fs.ReadStream {
    return fs.createReadStream(this.diskPath);
  }

  async download(): Promise<[Buffer]> {
    return [await readFile(this.diskPath)];
  }

  async save(data: Buffer, options: { metadata?: { contentType?: string } } = {}): Promise<void> {
    await mkdir(path.dirname(this.diskPath), { recursive: true });
    await writeFile(this.diskPath, data);
    if (options.metadata?.contentType) {
      await writeFile(
        this.metaPath,
        JSON.stringify({ contentType: options.metadata.contentType }),
      );
    }
  }

  async delete(options: { ignoreNotFound?: boolean } = {}): Promise<void> {
    try {
      await rm(this.diskPath, { force: false });
    } catch (error) {
      if (!options.ignoreNotFound) throw error;
    }
    await rm(this.metaPath, { force: true });
  }
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || 'public';
    return Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p.length > 0),
      ),
    );
  }

  getPrivateObjectDir(): string {
    return process.env.PRIVATE_OBJECT_DIR || 'private';
  }

  async searchPublicObject(filePath: string): Promise<LocalObjectFile | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const file = new LocalObjectFile(`${searchPath}/${filePath}`);
      const [exists] = await file.exists();
      if (exists) return file;
    }
    return null;
  }

  async downloadObject(file: LocalObjectFile, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === 'public';

    const nodeStream = file.createReadStream();
    const { Readable } = await import('stream');
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type': metadata.contentType || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) headers['Content-Length'] = String(metadata.size);

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    // Points back at our own PUT route (see routes/storage.ts) rather than a
    // signed cloud-storage URL — normalizeObjectEntityPath below recognizes
    // the leading /objects/ segment and passes it through unchanged.
    void privateObjectDir;
    return `/api/storage/objects/uploads/${objectId}`;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith('/objects/')) return rawPath;
    if (rawPath.startsWith('/api/storage/objects/')) {
      return rawPath.replace(/^\/api\/storage\/objects\//, '/objects/');
    }
    const match = rawPath.match(/\/uploads\/([^?]+)/);
    if (match) return `/objects/uploads/${match[1]}`;
    return rawPath;
  }

  async getObjectEntityFile(objectPath: string): Promise<LocalObjectFile> {
    if (!objectPath.startsWith('/objects/')) {
      throw new Error('Invalid object path: must start with /objects/');
    }
    const privateObjectDir = this.getPrivateObjectDir();
    const relativePath = objectPath.replace(/^\/objects\//, '');
    const file = new LocalObjectFile(`${privateObjectDir}/${relativePath}`);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }

  async uploadObjectEntity(objectPath: string, data: Buffer, contentType: string): Promise<void> {
    if (!objectPath.startsWith('/objects/')) {
      throw new Error('Invalid object path: must start with /objects/');
    }
    const privateObjectDir = this.getPrivateObjectDir();
    const relativePath = objectPath.replace(/^\/objects\//, '');
    const file = new LocalObjectFile(`${privateObjectDir}/${relativePath}`);
    await file.save(data, { metadata: { contentType } });
  }

  async deleteObjectEntity(objectPath: string): Promise<void> {
    try {
      const file = await this.getObjectEntityFile(objectPath);
      await file.delete({ ignoreNotFound: true });
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) {
        throw error;
      }
    }
  }

  async trySetObjectEntityAclPolicy(rawPath: string, aclPolicy: ObjectAclPolicy): Promise<string> {
    const objectPath = this.normalizeObjectEntityPath(rawPath);
    const file = await this.getObjectEntityFile(objectPath);
    await setObjectAclPolicy(file, aclPolicy);
    return objectPath;
  }

  async canAccessObjectEntity({ userId, objectFile, requestedPermission }: {
    userId?: string;
    objectFile: LocalObjectFile;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}
