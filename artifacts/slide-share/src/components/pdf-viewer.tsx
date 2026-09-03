import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

interface PdfViewerProps {
  pdfObjectPath: string;
  slideIndex: number;
  onLoadSuccess?: (numPages: number) => void;
  interactiveWords?: boolean;
  onWordClick?: (word: string) => void;
  className?: string;
}

export function PdfViewer({
  pdfObjectPath,
  slideIndex,
  onLoadSuccess,
  interactiveWords = false,
  onWordClick,
  className,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const textLayerRenderRef = useRef<pdfjsLib.TextLayer | null>(null);
  const renderSequenceRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    let active = true;
    const loadPdf = async () => {
      try {
        const url = `/api/storage${pdfObjectPath}`;
        const loadingTask = pdfjsLib.getDocument({ url });
        const pdf = await loadingTask.promise;
        if (!active) return;
        pdfRef.current = pdf;
        if (onLoadSuccess) {
          onLoadSuccess(pdf.numPages);
        }
        renderPage(slideIndex);
      } catch (err) {
        if (!active) return;
        console.error('Failed to load PDF', err);
        setError('Failed to load PDF document.');
      }
    };
    
    loadPdf();
    
    return () => {
      active = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
      textLayerRenderRef.current?.cancel();
      if (pdfRef.current) {
        (pdfRef.current as any).destroy?.();
        pdfRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfObjectPath]); // Deliberately leaving out onLoadSuccess

  const renderPage = async (index: number) => {
    if (!pdfRef.current || !canvasRef.current || !containerRef.current) return;

    const renderSequence = ++renderSequenceRef.current;
    try {
      setIsRendering(true);
      const pageNumber = index + 1;
      const numPages = pdfRef.current.numPages;
      if (pageNumber > numPages || pageNumber < 1) {
        setIsRendering(false);
        return;
      }
      
      const page = await pdfRef.current.getPage(pageNumber);

      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = containerRef.current.clientWidth;
      const availableHeight = containerRef.current.clientHeight;
      if (!availableWidth || !availableHeight) {
        setIsRendering(false);
        return;
      }

      // Fit the complete page inside the available stage. The canvas bitmap is
      // rendered at device-pixel resolution, while its CSS size stays at the
      // calculated fit size so the slide is never cropped.
      const fitScale = Math.min(
        availableWidth / baseViewport.width,
        availableHeight / baseViewport.height,
      );
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const displayViewport = page.getViewport({ scale: fitScale });
      const renderViewport = page.getViewport({ scale: fitScale * outputScale });

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      canvas.style.width = `${displayViewport.width}px`;
      canvas.style.height = `${displayViewport.height}px`;
      
      // Clear previous
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
      
      const renderTask = page.render({ canvasContext: ctx, viewport: renderViewport, canvas } as any);
      renderTaskRef.current = renderTask;
      const renderPromise = renderTask.promise.catch((renderError: any) => {
        if (renderError?.name === 'RenderingCancelledException') {
          return;
        }
        throw renderError;
      });

      if (interactiveWords && textLayerRef.current) {
        textLayerRenderRef.current?.cancel();
        textLayerRef.current.replaceChildren();
        textLayerRef.current.style.setProperty('--total-scale-factor', String(displayViewport.scale));
        const textContent = await page.getTextContent();
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerRef.current,
          viewport: displayViewport,
        });
        textLayerRenderRef.current = textLayer;
        await textLayer.render();
      }

      await renderPromise;
      if (renderSequence !== renderSequenceRef.current) return;
      setIsRendering(false);
    } catch (err: any) {
      if (err?.name === 'RenderingCancelledException') {
        // Ignored
      } else {
        console.error('Failed to render page', err);
      }
      setIsRendering(false);
    }
  };

  useEffect(() => {
    if (pdfRef.current) {
      renderPage(slideIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideIndex]);

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(() => {
      if (pdfRef.current) {
        renderPage(slideIndex);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [slideIndex]);
  
  if (error) {
    return (
      <div className={`flex items-center justify-center bg-card border border-border/50 text-muted-foreground rounded-xl ${className || ''}`}>
        <p className="text-sm font-medium">{error}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative flex h-full min-h-0 w-full min-w-0 items-center justify-center overflow-hidden ${className || ''}`}>
      <div className="relative max-h-full max-w-full overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block max-w-full max-h-full object-contain rounded-lg shadow-2xl transition-opacity duration-300"
          style={{ opacity: isRendering && !canvasRef.current?.width ? 0 : 1 }}
        />
        {interactiveWords && (
          <div
            ref={textLayerRef}
            className="pdf-text-layer"
            onClick={event => {
              const target = event.target as HTMLElement;
              if (target.tagName !== 'SPAN' || !target.textContent?.trim()) return;

              const text = target.textContent.trim();
              let offset = 0;
              const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
              if (range && target.contains(range.startContainer)) {
                offset = range.startOffset;
              }

              const match = [...text.matchAll(/\S+/g)].find(item => {
                const start = item.index ?? 0;
                return offset >= start && offset <= start + item[0].length;
              });
              onWordClick?.(match?.[0] ?? text);
            }}
          />
        )}
      </div>
    </div>
  );
}
