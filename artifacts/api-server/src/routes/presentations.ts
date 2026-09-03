import { Router, type IRouter } from 'express';
import { eq, ne } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { db, presentationsTable } from '@workspace/db';
import {
  CreatePresentationBody,
  CreatePresentationResponse,
  GetPresentationParams,
  GetPresentationResponse,
  UpdatePresentationParams,
  UpdatePresentationBody,
  UpdatePresentationResponse,
  ListPresentationsResponse,
  UpdateSlideParams,
  UpdateSlideBody,
  UpdateSlideResponse,
  ConvertPresentationParams,
  ConvertPresentationResponse,
  DeletePresentationParams,
  DeletePresentationBody,
  DeletePresentationResponse,
  PublishPresentationParams,
  PublishPresentationBody,
  PublishPresentationResponse,
  SetPresentationLiveParams,
  SetPresentationLiveBody,
  SetPresentationLiveResponse,
} from '@workspace/api-zod';
import { broadcastSlideChange } from '../lib/wsServer';
import { countSlides } from '../lib/slideCounter';
import { logger } from '../lib/logger';
import { ObjectStorageService } from '../lib/objectStorage';
import { PRESENTER_PASSWORD } from '../lib/presenterAuth';

const objectStorageService = new ObjectStorageService();
const execFileAsync = promisify(execFile);

const router: IRouter = Router();

router.get('/presentations', async (req, res): Promise<void> => {
  // Real-time polling endpoint — must never be served from cache.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  try {
    const rows = await db
      .select()
      .from(presentationsTable)
      .orderBy(presentationsTable.createdAt);
    res.json(ListPresentationsResponse.parse(rows));
  } catch (err) {
    req.log.error({ err }, 'Error listing presentations');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/presentations', async (req, res): Promise<void> => {
  const parsed = CreatePresentationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { title, fileName, fileObjectPath, contentType } = parsed.data;
  const id = randomUUID();

  try {
    const [row] = await db
      .insert(presentationsTable)
      .values({
        id,
        title,
        fileName,
        fileObjectPath,
        contentType,
        status: 'pending',
        currentSlide: 0,
      })
      .returning();

    res.status(201).json(CreatePresentationResponse.parse(row));
  } catch (err) {
    req.log.error({ err }, 'Error creating presentation');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/presentations/:id', async (req, res): Promise<void> => {
  const params = GetPresentationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .select()
    .from(presentationsTable)
    .where(eq(presentationsTable.id, params.data.id));

  if (!row) {
    res.status(404).json({ error: 'Presentation not found' });
    return;
  }

  res.json(GetPresentationResponse.parse(row));
});

router.patch('/presentations/:id', async (req, res): Promise<void> => {
  const params = UpdatePresentationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdatePresentationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  if (body.data.password !== PRESENTER_PASSWORD) {
    res.status(401).json({ error: 'Invalid admin password' });
    return;
  }

  const [row] = await db
    .update(presentationsTable)
    .set({ title: body.data.title.trim() })
    .where(eq(presentationsTable.id, params.data.id))
    .returning();

  if (!row) {
    res.status(404).json({ error: 'Presentation not found' });
    return;
  }

  res.json(UpdatePresentationResponse.parse(row));
});

router.patch('/presentations/:id/publish', async (req, res): Promise<void> => {
  const params = PublishPresentationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = PublishPresentationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  if (body.data.password !== PRESENTER_PASSWORD) {
    res.status(401).json({ error: 'Invalid admin password' });
    return;
  }

  const [current] = await db
    .select()
    .from(presentationsTable)
    .where(eq(presentationsTable.id, params.data.id));

  if (!current) {
    res.status(404).json({ error: 'Presentation not found' });
    return;
  }

  if (body.data.published && current.status !== 'ready') {
    res.status(400).json({ error: 'Only ready presentations can be published' });
    return;
  }

  const [row] = await db
    .update(presentationsTable)
    .set({ isPublished: body.data.published })
    .where(eq(presentationsTable.id, params.data.id))
    .returning();

  if (!row) {
    res.status(404).json({ error: 'Presentation not found' });
    return;
  }

  res.json(PublishPresentationResponse.parse(row));
});

router.patch('/presentations/:id/live', async (req, res): Promise<void> => {
  const params = SetPresentationLiveParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SetPresentationLiveBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  if (body.data.password !== PRESENTER_PASSWORD) {
    res.status(401).json({ error: 'Invalid presenter password' });
    return;
  }

  if (body.data.live) {
    await db
      .update(presentationsTable)
      .set({ isLive: false })
      .where(ne(presentationsTable.id, params.data.id));
  }

  const [row] = await db
    .update(presentationsTable)
    .set({ isLive: body.data.live })
    .where(eq(presentationsTable.id, params.data.id))
    .returning();

  if (!row) {
    res.status(404).json({ error: 'Presentation not found' });
    return;
  }

  res.json(SetPresentationLiveResponse.parse(row));
});

router.delete('/presentations/:id', async (req, res): Promise<void> => {
  const params = DeletePresentationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = DeletePresentationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  if (body.data.password !== PRESENTER_PASSWORD) {
    res.status(401).json({ error: 'Invalid admin password' });
    return;
  }

  const [row] = await db
    .select()
    .from(presentationsTable)
    .where(eq(presentationsTable.id, params.data.id));

  if (!row) {
    res.status(404).json({ error: 'Presentation not found' });
    return;
  }

  try {
    await objectStorageService.deleteObjectEntity(row.fileObjectPath);
    if (row.pdfObjectPath && row.pdfObjectPath !== row.fileObjectPath) {
      await objectStorageService.deleteObjectEntity(row.pdfObjectPath);
    }
    await db
      .delete(presentationsTable)
      .where(eq(presentationsTable.id, params.data.id));

    res.json(DeletePresentationResponse.parse({ success: true }));
  } catch (err) {
    req.log.error({ err, id: params.data.id }, 'Error deleting presentation');
    res.status(500).json({ error: 'Failed to delete presentation' });
  }
});

router.patch('/presentations/:id/slide', async (req, res): Promise<void> => {
  const params = UpdateSlideParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateSlideBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  if (body.data.password !== PRESENTER_PASSWORD) {
    res.status(401).json({ error: 'Invalid presenter password' });
    return;
  }

  // Fetch current row to compute the new maxRevealedSlide
  const [current] = await db
    .select()
    .from(presentationsTable)
    .where(eq(presentationsTable.id, params.data.id));

  if (!current) {
    res.status(404).json({ error: 'Presentation not found' });
    return;
  }

  const newMaxRevealed = Math.max(current.maxRevealedSlide, body.data.slideIndex);

  const [row] = await db
    .update(presentationsTable)
    .set({ currentSlide: body.data.slideIndex, maxRevealedSlide: newMaxRevealed })
    .where(eq(presentationsTable.id, params.data.id))
    .returning();

  if (!row) {
    res.status(404).json({ error: 'Presentation not found' });
    return;
  }

  // Broadcast the slide change (with maxRevealedSlide) to all viewers via WebSocket
  broadcastSlideChange(params.data.id, body.data.slideIndex, newMaxRevealed);

  res.json(UpdateSlideResponse.parse(row));
});

router.post('/presentations/:id/convert', async (req, res): Promise<void> => {
  const params = ConvertPresentationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .select()
    .from(presentationsTable)
    .where(eq(presentationsTable.id, params.data.id));

  if (!row) {
    res.status(404).json({ error: 'Presentation not found' });
    return;
  }

  // Start conversion asynchronously and respond immediately
  runConversion(params.data.id, row.fileObjectPath, row.contentType, row.pdfObjectPath).catch((err) =>
    logger.error({ err, id: params.data.id }, 'Background conversion failed'),
  );

  res.json(
    ConvertPresentationResponse.parse({
      status: 'converting',
      pdfObjectPath: null,
      slideCount: null,
      error: null,
    }),
  );
});

async function runConversion(
  id: string,
  fileObjectPath: string,
  contentType: string,
  previousPdfObjectPath?: string | null,
): Promise<void> {
  await db
    .update(presentationsTable)
    .set({ status: 'converting' })
    .where(eq(presentationsTable.id, id));

  try {
    const slideCount = await countSlides(fileObjectPath, contentType);

    const isPdf =
      contentType === 'application/pdf' ||
      contentType === 'application/x-pdf';
    const isPptx =
      contentType.includes('presentationml') ||
      contentType.includes('pptx') ||
      fileObjectPath.toLowerCase().endsWith('.pptx');

    const pdfObjectPath = isPdf
      ? fileObjectPath
      : isPptx
        ? await convertPptxToPdf(fileObjectPath)
        : null;

    await db
      .update(presentationsTable)
      .set({
        status: 'ready',
        pdfObjectPath,
        slideCount,
      })
      .where(eq(presentationsTable.id, id));

    if (
      previousPdfObjectPath &&
      previousPdfObjectPath !== fileObjectPath &&
      previousPdfObjectPath !== pdfObjectPath
    ) {
      await objectStorageService.deleteObjectEntity(previousPdfObjectPath);
    }

    logger.info({ id, slideCount }, 'Conversion complete');
  } catch (err) {
    logger.error({ err, id }, 'Conversion failed');
    await db
      .update(presentationsTable)
      .set({ status: 'error' })
      .where(eq(presentationsTable.id, id));
  }
}

async function convertPptxToPdf(fileObjectPath: string): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), 'slideshare-pptx-'));
  const sourcePath = join(workDir, 'presentation.pptx');
  const outputPath = join(workDir, 'presentation.pdf');
  const convertedObjectPath = `${fileObjectPath}.${randomUUID()}.pdf`;
  const fontDir = join(workDir, 'fonts');
  const fontConfigPath = join(workDir, 'fonts.conf');
  const conversionEnv = {
    ...process.env,
    FONTCONFIG_FILE: fontConfigPath,
    HOME: workDir,
  };

  try {
    const sourceFile = await objectStorageService.getObjectEntityFile(fileObjectPath);
    const [sourceBuffer] = await sourceFile.download();
    await writeFile(sourcePath, sourceBuffer);
    await copyInstalledPresentationFonts(fontDir);
    await writeFile(
      fontConfigPath,
      `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontDir}</dir>
  <dir>/usr/share/fonts</dir>
</fontconfig>
`,
    );
    await execFileAsync('fc-cache', ['-f', fontDir], { env: conversionEnv });

    await execFileAsync(
      'libreoffice',
      ['--headless', '--convert-to', 'pdf', '--outdir', workDir, sourcePath],
      { env: conversionEnv, timeout: 120000 },
    );

    const pdfBuffer = await readFile(outputPath);
    await objectStorageService.uploadObjectEntity(convertedObjectPath, pdfBuffer, 'application/pdf');
    return convertedObjectPath;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function copyInstalledPresentationFonts(fontDir: string): Promise<void> {
  await mkdir(fontDir, { recursive: true });

  let storeEntries: string[];
  try {
    storeEntries = await readdir('/nix/store');
  } catch {
    return;
  }

  const fontRoots = storeEntries
    .filter(entry => /-(?:lato|merriweather)-/i.test(entry))
    .map(entry => join('/nix/store', entry));
  const fontDirectories = [
    ...fontRoots.map(root => join(root, 'share/fonts/lato')),
    ...fontRoots.map(root => join(root, 'share/fonts/truetype/merriweather')),
    ...fontRoots.map(root => join(root, 'share/fonts/opentype/merriweather')),
  ];

  for (const directory of fontDirectories) {
    let files: string[];
    try {
      files = await readdir(directory);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!/\.(?:ttf|otf)$/i.test(file)) continue;
      await cp(join(directory, file), join(fontDir, file), { force: true });
    }
  }
}

export default router;
