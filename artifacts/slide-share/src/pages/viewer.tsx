import { useEffect, useState, useRef } from 'react';
import { useRoute, useLocation } from 'wouter';
import { Maximize, Minimize, Radio, Loader2, Download, File as FileIcon, ChevronLeft, ChevronRight, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useGetPresentation, getGetPresentationQueryKey } from '@workspace/api-client-react';
import { usePresentationSync } from '@/hooks/use-presentation-sync';
import { PdfViewer } from '@/components/pdf-viewer';
import { BrandLogo } from '@/components/brand-logo';

export default function ViewerPage() {
  const [, params] = useRoute('/view/:id');
  const [, setLocation] = useLocation();
  const id = params?.id;

  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // The slide the viewer is personally looking at (may differ from presenter's current)
  const [viewerSlide, setViewerSlide] = useState(0);

  const { data: presentation, isLoading, error } = useGetPresentation(id || '', {
    query: {
      enabled: !!id,
      queryKey: getGetPresentationQueryKey(id || ''),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'ready' || status === 'error' ? false : 2000;
      }
    }
  });

  const { currentSlide, maxRevealedSlide, isConnected } = usePresentationSync(
    presentation?.status === 'ready' ? id : undefined,
    presentation?.maxRevealedSlide ?? -1,
    presentation?.currentSlide ?? 0,
  );

  // When the presenter moves to a new slide during a LIVE session, auto-follow.
  // For archived (non-live) presentations don't auto-follow — let the viewer
  // browse freely from slide 0.
  useEffect(() => {
    if (presentation?.isLive && maxRevealedSlide >= 0) {
      setViewerSlide(currentSlide);
    }
  }, [currentSlide, maxRevealedSlide, presentation?.isLive]);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen().catch(err => {
        console.error(`Fullscreen error: ${(err as Error).message}`);
      });
    } else {
      await document.exitFullscreen();
    }
  };

  const goHome = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    }
    setLocation('/');
  };

  const homeButton = (
    <Button
      variant="ghost"
      size="sm"
      onClick={goHome}
      className="gap-1.5 text-[#fff8df] hover:bg-[#6c3040] hover:text-[#f0d875]"
    >
      <Home className="h-4 w-4" />
      Homepage
    </Button>
  );

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  if (isLoading || !presentation) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-foreground">
        <div className="fixed left-4 top-4">{homeButton}</div>
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading presentation...</p>
      </div>
    );
  }

  if (error || presentation.status === 'error') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-foreground p-6 text-center">
        <div className="fixed left-4 top-4">{homeButton}</div>
        <div className="w-16 h-16 bg-destructive/20 rounded-full flex items-center justify-center mb-4">
          <span className="text-destructive text-2xl font-bold">!</span>
        </div>
        <h1 className="text-2xl font-bold mb-2">Presentation Unavailable</h1>
        <p className="text-muted-foreground">The presentation could not be loaded or encountered an error.</p>
      </div>
    );
  }

  if (presentation.status !== 'ready') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-foreground p-6 text-center">
        <div className="fixed left-4 top-4">{homeButton}</div>
        <Loader2 className="w-12 h-12 animate-spin text-primary mb-6" />
        <h1 className="text-3xl font-bold mb-2">Waiting for presenter...</h1>
        <p className="text-muted-foreground max-w-md">The presentation is still converting. It will appear here automatically.</p>
      </div>
    );
  }

  // For a non-live presentation students can browse all slides freely.
  // While live, viewers can only go back to slides already shown — not ahead of the presenter's
  // current position (currentSlide). maxRevealedSlide is kept only as an initialisation fallback.
  const isLiveNow = !!presentation.isLive;
  const slideTotal = presentation.slideCount != null ? presentation.slideCount - 1 : -1;
  const liveMax = maxRevealedSlide >= 0 ? maxRevealedSlide : presentation.maxRevealedSlide;
  // During a live session: cap at the presenter's current slide so viewers can't jump ahead.
  // After the session ends: allow free navigation up to the last slide (or total slides).
  const effectiveMax = isLiveNow ? currentSlide : (slideTotal >= 0 ? slideTotal : liveMax);
  if (effectiveMax < 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-foreground p-6 text-center">
        <div className="fixed left-4 top-4">{homeButton}</div>
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-6 border border-primary/20">
          <Radio className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold mb-2">{presentation.title}</h1>
        <p className="text-muted-foreground max-w-md mt-2">Waiting for the presenter to start. Slides will appear here automatically.</p>
        {isConnected && (
          <Badge variant="default" className="mt-6 bg-green-500/20 text-green-500 border-green-500/30 gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Live — Connected
          </Badge>
        )}
      </div>
    );
  }

  const canGoPrev = viewerSlide > 0;
  const canGoNext = viewerSlide < effectiveMax;

  return (
    <div ref={containerRef} className="h-screen w-full bg-background text-foreground flex flex-col overflow-hidden selection:bg-primary/30">

      <header className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-4 transition-opacity ${isFullscreen ? 'opacity-0 hover:opacity-100 bg-[#843b49]/90 backdrop-blur-md' : 'bg-[#843b49]/95 backdrop-blur-md border-b border-[#d8bf5e]/50'}`}>
        <div className="flex items-center gap-4">
          {homeButton}
          <BrandLogo compact />
          <h1 className="text-lg font-semibold truncate max-w-[300px] md:max-w-md">{presentation.title}</h1>
          {isConnected ? (
            <Badge variant="default" className="bg-green-500/20 text-green-500 hover:bg-green-500/30 gap-1.5 border-green-500/30">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Live
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1.5 opacity-70">
              <Radio className="w-3 h-3" />
              Connecting...
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-3">
          {presentation.slideCount != null && (
            <div className="text-sm font-medium text-[#fff8df] font-mono bg-[#6c3040] px-3 py-1 rounded-md border border-[#d8bf5e]/40">
              {String(viewerSlide + 1).padStart(2, '0')} / {String(effectiveMax + 1).padStart(2, '0')}
              {effectiveMax < (presentation.slideCount - 1) && (
                <span className="text-muted-foreground/50 ml-1 text-xs">(of {presentation.slideCount})</span>
              )}
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="text-[#fff8df] hover:bg-[#6c3040] hover:text-[#f0d875]">
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </Button>
        </div>
      </header>

      <main className="absolute inset-0 flex items-center justify-center overflow-hidden bg-black/40">
        {presentation.pdfObjectPath ? (
          <PdfViewer
            pdfObjectPath={presentation.pdfObjectPath}
            slideIndex={viewerSlide}
            className="w-full h-full"
          />
        ) : (
          <div className="text-center space-y-6 max-w-lg p-12 rounded-xl bg-card border border-border/50">
            <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-2">
              <FileIcon className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold">Browser rendering not supported</h2>
            <p className="text-muted-foreground">This presentation format cannot be rendered directly in the browser.</p>
            <Button asChild className="w-full h-12 text-md font-semibold mt-4">
              <a href={`/api/storage${presentation.fileObjectPath}`} download>
                <Download className="w-5 h-5 mr-2" />
                Download Original File
              </a>
            </Button>
            <div className="pt-6 border-t border-border/40 mt-6 flex justify-center items-center gap-4">
              <p className="text-sm font-medium text-muted-foreground">Following presenter...</p>
              <div className="text-lg font-mono font-bold">Slide {viewerSlide + 1}</div>
            </div>
          </div>
        )}
      </main>

      {/* Viewer navigation — only shown when slides have been revealed */}
      <footer className={`absolute bottom-0 left-0 right-0 z-20 border-t border-[#d8bf5e]/30 bg-[#843b49]/90 backdrop-blur-sm px-6 py-3 flex items-center justify-center gap-4 transition-opacity ${isFullscreen ? 'opacity-0 hover:opacity-100' : ''}`}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setViewerSlide(s => Math.max(0, s - 1))}
          disabled={!canGoPrev}
          className="text-muted-foreground"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Prev
        </Button>
        <span className="text-xs text-muted-foreground px-2">
          You can browse any slide the presenter has shown
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setViewerSlide(s => Math.min(effectiveMax, s + 1))}
          disabled={!canGoNext}
          className="text-muted-foreground"
        >
          Next
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </footer>
    </div>
  );
}
