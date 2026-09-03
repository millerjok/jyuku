import { useEffect, useState, useRef, useCallback } from 'react';
import { useRoute, useLocation } from 'wouter';
import { Maximize, Minimize, ChevronLeft, ChevronRight, Copy, Check, Lock, Loader2, Play, Users, LogOut, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useGetPresentation, useSetPresentationLive, useUpdateSlide, getGetPresentationQueryKey } from '@workspace/api-client-react';
import { usePresentationSync } from '@/hooks/use-presentation-sync';
import { PdfViewer } from '@/components/pdf-viewer';
import { useQueryClient } from '@tanstack/react-query';
import { BrandLogo } from '@/components/brand-logo';
import { getAdminPassword, setAdminPassword, clearAdminPassword, isAdminUnlocked, isAuthError, verifyAdminPassword } from '@/lib/admin-auth';

export default function PresenterPage() {
  const [, params] = useRoute('/present/:id');
  const [, setLocation] = useLocation();
  const id = params?.id;

  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  // Tracks whether we've already called the API to stop the presentation,
  // so the auto-cleanup effects don't send a redundant request.
  const hasExitedRef = useRef(false);

  // PRESENTER_PASSWORD lives server-side, so the typed password is checked
  // against POST /api/auth/verify before access is granted.
  const [isAuthenticated, setIsAuthenticated] = useState(isAdminUnlocked);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [verifying, setVerifying] = useState(false);
  
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [speakingWord, setSpeakingWord] = useState<string | null>(null);

  // We only fetch once authenticated to avoid unneeded calls, but we need presentation info anyway.
  // Actually, we can fetch presentation details immediately.
  const { data: presentation, isLoading, error } = useGetPresentation(id || '', {
    query: {
      enabled: !!id,
      queryKey: getGetPresentationQueryKey(id || '')
    }
  });

  const { mutateAsync: updateSlide } = useUpdateSlide();
  const { mutateAsync: setPresentationLive } = useSetPresentationLive();
  const [isExiting, setIsExiting] = useState(false);
  const { currentSlide, setCurrentSlide, isConnected, sendSlideUpdate } = usePresentationSync(
    isAuthenticated && presentation?.status === 'ready' ? id : undefined,
    presentation?.maxRevealedSlide ?? -1,
    presentation?.currentSlide ?? 0,
  );
  const initializedPresentationRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !id || !presentation || presentation.status !== 'ready') return;
    if (initializedPresentationRef.current === id) return;

    initializedPresentationRef.current = id;
    setCurrentSlide(presentation.currentSlide);
    const startLivePresentation = async () => {
      try {
        await setPresentationLive({ id, data: { password: getAdminPassword(), live: true } });
        await updateSlide({ id, data: { password: getAdminPassword(), slideIndex: presentation.currentSlide } });
      } catch (err) {
        initializedPresentationRef.current = null;
        console.error('Failed to start live presentation', err);
        if (isAuthError(err)) {
          // The stored password was wrong — bounce back to the gate rather
          // than sitting on a "connecting" screen that will never resolve.
          clearAdminPassword();
          setIsAuthenticated(false);
          setPasswordError(true);
        }
      }
    };
    void startLivePresentation();
  }, [id, isAuthenticated, presentation, setCurrentSlide, setPresentationLive, updateSlide]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(false);
    setVerifying(true);
    try {
      if (!(await verifyAdminPassword(password))) {
        setPasswordError(true);
        return;
      }
      setAdminPassword(password);
      setIsAuthenticated(true);
      // Initialize local slide to server's current slide
      if (presentation) {
        setCurrentSlide(presentation.currentSlide);
      }
    } finally {
      setVerifying(false);
    }
  };

  const changeSlide = useCallback(async (newIndex: number) => {
    if (!presentation || !id || newIndex < 0) return;
    const maxIndex = (presentation.slideCount || 1) - 1;
    if (newIndex > maxIndex) return;

    // Optimistic UI update
    setCurrentSlide(newIndex);
    // Broadcast immediately via WS
    sendSlideUpdate(newIndex);

    // Persist to DB
    try {
      await updateSlide({ id, data: { password: getAdminPassword(), slideIndex: newIndex } });
    } catch (err) {
      console.error('Failed to update slide in DB', err);
    }
  }, [presentation, id, setCurrentSlide, sendSlideUpdate, updateSlide]);

  const handlePrev = useCallback(() => {
    changeSlide(currentSlide - 1);
  }, [currentSlide, changeSlide]);

  const handleNext = useCallback(() => {
    changeSlide(currentSlide + 1);
  }, [currentSlide, changeSlide]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isAuthenticated) return;
      const target = e.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.tagName === 'SELECT'
        || target?.isContentEditable;
      if (isTyping || e.repeat) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.code === 'Space') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        handlePrev();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthenticated, handleNext, handlePrev]);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen().catch(err => console.error(err));
    } else {
      await document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/view/${id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const pronounceWord = useCallback((word: string) => {
    if (!('speechSynthesis' in window)) {
      setSpeakingWord(null);
      return;
    }

    window.speechSynthesis.cancel();
    setSpeakingWord(word);

    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-AU';
    utterance.rate = 0.85;
    utterance.onend = () => setSpeakingWord(current => current === word ? null : current);
    utterance.onerror = () => setSpeakingWord(current => current === word ? null : current);
    window.speechSynthesis.speak(utterance);
  }, []);

  useEffect(() => {
    return () => window.speechSynthesis?.cancel();
  }, []);

  // ── Auto-stop when the admin navigates away without clicking Exit ────────────
  // Covers: SPA navigation (wouter setLocation), back button, link clicks.
  useEffect(() => {
    if (!isAuthenticated || !id) return;
    return () => {
      if (hasExitedRef.current) return; // already stopped via the Exit button
      // keepalive: true lets the request complete even as the component unmounts.
      void fetch(`/api/presentations/${id}/live`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: getAdminPassword(), live: false }),
        keepalive: true,
      });
    };
  }, [isAuthenticated, id]);

  // ── Auto-stop when the browser tab is closed or hard-refreshed ──────────────
  useEffect(() => {
    if (!isAuthenticated || !id) return;
    const stopOnUnload = () => {
      if (hasExitedRef.current) return;
      void fetch(`/api/presentations/${id}/live`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: getAdminPassword(), live: false }),
        keepalive: true,
      });
    };
    window.addEventListener('beforeunload', stopOnUnload);
    return () => window.removeEventListener('beforeunload', stopOnUnload);
  }, [isAuthenticated, id]);

  const exitPresentation = async () => {
    if (isExiting) return;
    setIsExiting(true);
    hasExitedRef.current = true; // prevent the cleanup effects from double-firing

    try {
      if (id) {
        await setPresentationLive({
          id,
          data: { password: getAdminPassword(), live: false },
        });
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined);
      }
      setLocation('/');
    } catch (err) {
      console.error('Failed to stop the audience presentation', err);
      setIsExiting(false);
    }
  };

  if (isLoading || !presentation) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || presentation.status === 'error') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <div className="text-destructive mb-4">Error loading presentation</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-border/50 bg-card/80 backdrop-blur-md shadow-2xl">
          <CardHeader className="text-center pb-8">
            <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-3xl font-bold">Presenter Access</CardTitle>
            <CardDescription className="text-base mt-2">Enter the password to take control of {presentation.title}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUnlock} className="space-y-6">
              <div className="space-y-2">
                <Input 
                  type="password" 
                  placeholder="Enter password" 
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={`h-12 text-lg px-4 bg-black/40 ${passwordError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                  autoFocus
                />
                {passwordError && (
                  <p className="text-sm text-destructive font-medium">Incorrect password. Please try again.</p>
                )}
              </div>
              <Button type="submit" className="w-full h-12 text-lg font-semibold" disabled={verifying}>
                {verifying ? 'Checking…' : 'Unlock Booth'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isFirstSlide = currentSlide === 0;
  const isLastSlide = presentation.slideCount != null && currentSlide >= presentation.slideCount - 1;

  return (
    <div ref={containerRef} className="h-screen w-full bg-[#171116] text-[#fff8df] flex flex-col overflow-hidden selection:bg-primary/30">
      
      {/* Top control bar */}
      <header className={`flex-shrink-0 flex items-center justify-between px-6 py-4 bg-[#843b49] border-b border-[#d8bf5e]/50 transition-opacity ${isFullscreen ? 'opacity-0 hover:opacity-100 absolute w-full z-50' : ''}`}>
        <div className="flex items-center gap-6">
          <BrandLogo compact />
          <div className="flex flex-col">
            <h1 className="text-sm font-semibold text-[#f0d875] uppercase tracking-wider mb-1">Now Driving</h1>
            <h2 className="text-lg font-bold truncate max-w-[300px] md:max-w-md">{presentation.title}</h2>
          </div>
          
          <Badge variant="outline" className={`gap-2 py-1.5 px-3 border-[#d8bf5e]/50 ${isConnected ? 'bg-[#f0d875]/15 text-[#f0d875] border-[#d8bf5e]/60' : 'bg-[#6c3040]/70 text-[#fff8df]'}`}>
            {isConnected ? (
              <><span className="w-2 h-2 rounded-full bg-primary animate-pulse" /> Live Broadcast</>
            ) : (
              <><Loader2 className="w-3 h-3 animate-spin" /> Connecting</>
            )}
          </Badge>
          {speakingWord && (
            <Badge variant="outline" className="max-w-[220px] gap-2 truncate border-[#f0d875]/60 bg-[#f0d875]/15 text-[#f0d875]">
              <Volume2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Pronouncing “{speakingWord}”</span>
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={exitPresentation} disabled={isExiting} className="bg-[#6c3040] border-[#d8bf5e]/40 text-[#fff8df] hover:bg-[#552735]">
            {isExiting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LogOut className="w-4 h-4 mr-2" />}
            {isExiting ? 'Stopping' : 'Exit'}
          </Button>
          <Button variant="outline" size="sm" onClick={copyLink} className="bg-[#6c3040] border-[#d8bf5e]/40 text-[#fff8df] hover:bg-[#552735]">
            {copied ? <Check className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
            {copied ? 'Copied' : 'Viewer Link'}
          </Button>
          
          <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="text-[#fff8df] hover:bg-[#6c3040] hover:text-[#f0d875]">
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </Button>
        </div>
      </header>

      {/* Main slide stage */}
       <main className={`flex-1 relative flex items-center justify-center overflow-hidden ${isFullscreen ? 'p-0' : 'p-6 md:p-12'}`}>
        {presentation.pdfObjectPath ? (
          <PdfViewer 
            pdfObjectPath={presentation.pdfObjectPath} 
            slideIndex={currentSlide} 
            interactiveWords
            onWordClick={pronounceWord}
             className={`w-full h-full overflow-hidden bg-black ${
               isFullscreen
                 ? 'max-w-none rounded-none border-0 shadow-none'
                 : 'max-w-[1400px] rounded-lg border border-border/10 shadow-[0_0_80px_rgba(0,0,0,0.5)]'
             }`}
          />
        ) : (
          <div className="text-center p-12 max-w-lg bg-[#111] rounded-xl border border-border/20 shadow-2xl">
             <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Play className="w-10 h-10 text-primary ml-2" />
             </div>
             <h2 className="text-2xl font-bold mb-2">Driving Slide {currentSlide + 1}</h2>
             <p className="text-muted-foreground mb-8">Viewers are seeing this slide change in real-time, but browser rendering is unavailable for this format.</p>
          </div>
        )}
      </main>

      {/* Bottom control desk */}
      <footer className={`flex-shrink-0 border-t border-[#d8bf5e]/40 bg-[#843b49] p-6 transition-transform ${isFullscreen ? 'translate-y-full absolute bottom-0 w-full hover:translate-y-0 opacity-0 hover:opacity-100 z-50' : ''}`}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          
          <div className="flex-1 flex items-center gap-4">
             <div className="text-3xl font-mono font-bold tracking-tight">
               {String(currentSlide + 1).padStart(2, '0')}
                <span className="text-[#f0d875]/60 text-xl mx-2">/</span>
                <span className="text-[#f0d875] text-2xl">{presentation.slideCount ? String(presentation.slideCount).padStart(2, '0') : '??'}</span>
             </div>
          </div>

          <div className="flex-1 flex justify-center gap-4">
            <Button 
              variant="outline" 
              size="lg" 
              onClick={handlePrev} 
              disabled={isFirstSlide}
              className="w-32 h-14 bg-[#1a1a1a] border-border/40 hover:bg-[#222] hover:border-border text-lg font-semibold"
            >
              <ChevronLeft className="w-6 h-6 mr-2" />
              Prev
            </Button>
            <Button 
              size="lg" 
              onClick={handleNext}
              disabled={isLastSlide}
              className="w-32 h-14 text-lg font-semibold shadow-[0_0_20px_rgba(var(--primary),0.3)] hover:shadow-[0_0_30px_rgba(var(--primary),0.5)] transition-shadow"
            >
              Next
              <ChevronRight className="w-6 h-6 ml-2" />
            </Button>
          </div>
          
          <div className="flex-1 flex justify-end">
             {/* Could add speaker notes toggle or viewer count here if API supported viewer count */}
               <div className="flex items-center text-sm font-medium text-[#fff8df] bg-[#6c3040] px-4 py-2 rounded-full border border-[#d8bf5e]/30">
               <Users className="w-4 h-4 mr-2 opacity-70" />
               Live Sync Active
             </div>
          </div>
          
        </div>
      </footer>
    </div>
  );
}
