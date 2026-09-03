import { ObjectStorageService } from './objectStorage';

const storageService = new ObjectStorageService();

export async function countSlides(objectPath: string, contentType: string): Promise<number> {
  const file = await storageService.getObjectEntityFile(objectPath);

  const chunks: Buffer[] = [];
  const stream = file.createReadStream();

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  const buffer = Buffer.concat(chunks);

  const isPdf =
    contentType === 'application/pdf' ||
    contentType === 'application/x-pdf' ||
    objectPath.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    // PDF page objects can be compressed into object streams, so counting
    // textual `/Type /Page` markers is unreliable. Use the PDF parser's
    // document metadata instead.
    const runtime = globalThis as Record<string, unknown>;
    if (!runtime.DOMMatrix) {
      class DOMMatrixPolyfill {
        a = 1;
        b = 0;
        c = 0;
        d = 1;
        e = 0;
        f = 0;
      }
      Object.assign(runtime, {
        DOMMatrix: DOMMatrixPolyfill,
        ImageData: class ImageDataPolyfill {},
        Path2D: class Path2DPolyfill {},
      });
    }

    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });

    try {
      const { total } = await parser.getInfo();
      return Math.max(total, 1);
    } finally {
      await parser.destroy();
    }
  }

  const isPptx =
    contentType.includes('presentationml') ||
    contentType.includes('pptx') ||
    objectPath.toLowerCase().endsWith('.pptx');

  if (isPptx) {
    // Count slides in PPTX (ZIP archive) by counting slide XML files
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(buffer);
    const slideFiles = zip.getEntries().filter((e) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName),
    );
    return slideFiles.length || 1;
  }

  // PPT (old binary format) — cannot count easily without LibreOffice
  return 1;
}
