import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import {
  UploadCloud, File as FileIcon, FileText,
  Loader2, PlayCircle, ArrowRight, Lock, Eye, Maximize, Minimize,
  Radio, Download, ChevronLeft, ChevronRight, Trash2, ClipboardCheck, BarChart3, Pencil, Check, X,
  PanelLeftOpen, PanelLeftClose, StopCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  useRequestUploadUrl,
  useCreatePresentation,
  useConvertPresentation,
  useDeletePresentation,
  usePublishPresentation,
  useListPresentations,
  getListPresentationsQueryKey,
  useGetPresentation,
  getGetPresentationQueryKey,
  getGetPresentationQuizQueryOptions,
  useGeneratePresentationQuiz,
  useGetQuizResults,
  useUpdatePresentation,
  useSetPresentationLive
} from '@workspace/api-client-react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { BrandLogo } from '@/components/brand-logo';
import { PdfViewer } from '@/components/pdf-viewer';
import { usePresentationSync } from '@/hooks/use-presentation-sync';
import { readBrowserQuizScores } from '@/lib/quiz-score-storage';
import { getAdminPassword, setAdminPassword, clearAdminPassword, isAdminUnlocked, isAuthError, verifyAdminPassword } from '@/lib/admin-auth';

// ─── Password Gate ────────────────────────────────────────────────────────────
// PRESENTER_PASSWORD lives server-side (often a random value the host
// generated at deploy time), so the typed password is checked against
// POST /api/auth/verify before the dashboard is ever rendered.
function AdminPasswordGate({ onUnlock, onClose }: { onUnlock: () => void; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(false);
    setVerifying(true);
    try {
      if (await verifyAdminPassword(password)) {
        setAdminPassword(password);
        onUnlock();
      } else {
        setError(true);
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="relative w-full max-w-md border-border/50 bg-card/80 backdrop-blur-md shadow-2xl">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close admin access"
          className="absolute right-3 top-3 text-muted-foreground hover:bg-primary/10 hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </Button>
        <CardHeader className="text-center pb-8">
          <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold">Admin Access</CardTitle>
          <CardDescription className="text-base mt-2">Enter the admin password to upload and manage presentations.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(false); }}
                className={`h-12 text-lg px-4 bg-black/40 ${error ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                autoFocus
              />
              {error && (
                <p className="text-sm text-destructive font-medium">Incorrect password. Please try again.</p>
              )}
            </div>
            <Button type="submit" className="w-full h-12 text-lg font-semibold" disabled={verifying}>
              {verifying ? 'Checking…' : 'Unlock'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Viewer Landing (non-admin) ───────────────────────────────────────────────
export function ViewerLanding({ onAdminClick }: { onAdminClick: () => void }) {
  const { data: presentations } = useListPresentations({
    query: {
      // Always re-fetch fresh data on mount (e.g. after admin exits presenter page)
      // so stale "isLive" or "isPublished" state is never shown to students.
      refetchOnMount: 'always',
      refetchInterval: 1000,
      queryKey: getListPresentationsQueryKey(),
    },
  });
  const [viewerSlide, setViewerSlide] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [quizScores, setQuizScores] = useState(readBrowserQuizScores);
  const stageRef = useRef<HTMLDivElement>(null);

  const ready = presentations?.filter(p => p.status === 'ready') ?? [];
  // Live check is independent of published status so an unpublished slide can still be presented.
  const livePresentation = ready.find(p => p.isLive);
  const previousPresentations = ready
    .filter(p => p.isPublished && p.id !== livePresentation?.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const quizQueries = useQueries({
    queries: previousPresentations.map(pres => ({
      ...getGetPresentationQuizQueryOptions(pres.id),
      enabled: sidebarOpen,
      retry: false,
      refetchInterval: sidebarOpen ? 5000 : false,
      staleTime: 0,
    })),
  });
  const { currentSlide, maxRevealedSlide, isConnected } = usePresentationSync(
    livePresentation?.id,
    livePresentation?.maxRevealedSlide ?? -1,
    livePresentation?.currentSlide ?? 0,
  );
  const effectiveMax = maxRevealedSlide >= 0
    ? maxRevealedSlide
    : livePresentation?.maxRevealedSlide ?? -1;

  useEffect(() => {
    if (livePresentation && effectiveMax >= 0) {
      setViewerSlide(currentSlide);
    }
  }, [livePresentation?.id, currentSlide, effectiveMax]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const refreshQuizScores = () => setQuizScores(readBrowserQuizScores());
    const handleVisibilityChange = () => {
      if (!document.hidden) refreshQuizScores();
    };

    refreshQuizScores();
    window.addEventListener('focus', refreshQuizScores);
    window.addEventListener('storage', refreshQuizScores);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshQuizScores);
      window.removeEventListener('storage', refreshQuizScores);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await stageRef.current?.requestFullscreen().catch(err => console.error(err));
    } else {
      await document.exitFullscreen();
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground selection:bg-primary/30">
      {/* Header */}
      <header className="shrink-0 border-b border-[#d8bf5e]/50 bg-[#843b49] z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <BrandLogo />
          <Button variant="ghost" size="sm" onClick={onAdminClick} className="text-muted-foreground text-xs gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            Admin
          </Button>
        </div>
      </header>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar (previous presentations) ── */}
        {previousPresentations.length > 0 && (
          <aside
            className={`relative z-10 shrink-0 flex flex-col border-r border-[#d8bf5e]/20 bg-card/30 transition-all duration-300 ${sidebarOpen ? 'w-72' : 'w-12'}`}
          >
            {/* Toggle button — kept fully inside the aside so it never overlaps main */}
            <button
              onClick={() => setSidebarOpen(o => !o)}
              className="absolute right-2 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-[#d8bf5e]/30 bg-[#843b49] text-[#fff8df] shadow-md hover:bg-[#6c3040] transition-colors"
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              {sidebarOpen
                ? <PanelLeftClose className="h-4 w-4" />
                : <PanelLeftOpen className="h-4 w-4" />}
            </button>

            {/* Collapsed hint */}
            {!sidebarOpen && (
              <div className="mt-14 flex flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground/60 [writing-mode:vertical-rl] rotate-180 select-none">
                  Previous
                </span>
              </div>
            )}

            {/* Expanded content */}
            {sidebarOpen && (
              <div className="flex flex-col gap-3 overflow-y-auto p-4 pt-14">
                <p className="text-xs font-semibold uppercase tracking-widest text-[#f0d875]">
                  Previous presentations
                </p>
                {previousPresentations.map(pres => {
                  const savedScore = quizScores[pres.id];
                  return (
                    <Card key={pres.id} className="bg-card/60 border-border/40 hover:bg-card/80 transition-colors">
                      <CardContent className="flex flex-col gap-2 p-3">
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="line-clamp-2 min-w-0 text-sm font-semibold leading-snug" title={pres.title}>{pres.title}</h3>
                            {savedScore && (
                              <Badge
                                variant="secondary"
                                className="shrink-0 border-green-500/30 bg-green-500/10 px-2 py-0.5 font-mono text-[11px] text-green-600"
                                aria-label={`Your quiz score is ${savedScore.score} out of ${savedScore.total}`}
                              >
                                {savedScore.score} / {savedScore.total}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{new Date(pres.createdAt).toLocaleDateString()}</p>
                        </div>
                        <Button variant="secondary" size="sm" className="w-full gap-1.5 text-xs h-7" asChild>
                          <Link href={`/view/${pres.id}`}>
                            <Eye className="h-3 w-3" />
                            Watch
                          </Link>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className={`h-7 w-full gap-1.5 text-xs ${
                            quizQueries[previousPresentations.indexOf(pres)]?.isSuccess
                              ? 'border-[#f0d875]/50 text-[#f0d875] hover:bg-[#f0d875]/10 hover:text-[#f7e59b]'
                              : 'border-border/50 text-muted-foreground hover:bg-muted/20 hover:text-muted-foreground'
                          }`}
                          asChild
                        >
                          <Link href={`/quiz/${pres.id}`}>
                            <ClipboardCheck className="h-3 w-3" />
                            {savedScore ? 'Re-attempt the quiz' : 'Do-Now Quiz'}
                          </Link>
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </aside>
        )}

        {/* ── Main stage ── */}
        <main className="relative flex-1 overflow-hidden bg-[#171116]" ref={stageRef}>

          {/* Loading */}
          {!presentations && (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* No live presentation */}
          {presentations && !livePresentation && (
            <div className="flex h-full items-center justify-center p-10">
              <div className="max-w-sm border border-dashed border-border/50 bg-card/20 p-12 text-center rounded-xl">
                <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-muted-foreground">No live presentation available yet.</p>
              </div>
            </div>
          )}

          {/* Live presentation */}
          {livePresentation && (
            <>
              {effectiveMax < 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                  <Radio className="mb-6 h-12 w-12 text-[#f0d875]" />
                  <h1 className="text-3xl font-bold">{livePresentation.title}</h1>
                  <p className="mt-2 text-[#fff8df]/70">Waiting for the presenter to start.</p>
                  {isConnected && (
                    <Badge className="mt-6 gap-1.5 border-green-500/30 bg-green-500/20 text-green-400">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                      Live
                    </Badge>
                  )}
                </div>
              ) : (
                /* Flex-column layout so bars never overlap the slide */
                <div className="flex h-full flex-col">
                  {/* Top bar */}
                  <div className="shrink-0 flex items-center justify-between bg-[#843b49]/90 px-6 py-3 backdrop-blur-md">
                    <div className="flex items-center gap-3">
                      <h1 className="max-w-[55vw] truncate font-semibold text-[#fff8df]">{livePresentation.title}</h1>
                      <Badge className={`gap-1.5 border-[#d8bf5e]/40 ${isConnected ? 'bg-green-500/20 text-green-400' : 'bg-[#6c3040] text-[#f0d875]'}`}>
                        <span className={`h-2 w-2 rounded-full ${isConnected ? 'animate-pulse bg-green-500' : 'bg-[#f0d875]'}`} />
                        {isConnected ? 'Live' : 'Connecting'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-[#fff8df]">
                        {String(viewerSlide + 1).padStart(2, '0')} / {String(currentSlide + 1).padStart(2, '0')}
                      </span>
                      <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="text-[#fff8df] hover:bg-[#6c3040] hover:text-[#f0d875]">
                        {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
                      </Button>
                    </div>
                  </div>

                  {/* Slide — takes all remaining space between the two bars */}
                  <div className="flex flex-1 items-center justify-center overflow-hidden">
                    {livePresentation.pdfObjectPath ? (
                      <PdfViewer
                        pdfObjectPath={livePresentation.pdfObjectPath}
                        slideIndex={viewerSlide}
                        className="h-full w-full"
                      />
                    ) : (
                      <div className="max-w-lg rounded-xl border border-[#d8bf5e]/30 bg-[#6c3040] p-12 text-center">
                        <Download className="mx-auto mb-5 h-10 w-10 text-[#f0d875]" />
                        <h2 className="text-2xl font-bold text-[#fff8df]">Browser rendering not supported</h2>
                        <p className="mt-3 text-[#fff8df]/70">Download the presentation to view this file.</p>
                        <Button asChild className="mt-6 w-full bg-[#f0d875] text-[#4b2430] hover:bg-[#f7e59b]">
                          <a href={`/api/storage${livePresentation.fileObjectPath}`} download>
                            Download Original File
                          </a>
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Bottom nav */}
                  <div className="shrink-0 flex items-center justify-center gap-6 bg-[#843b49]/90 px-6 py-3 backdrop-blur-md">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={viewerSlide <= 0}
                      onClick={() => setViewerSlide(slide => Math.max(0, slide - 1))}
                      className="text-[#fff8df] hover:bg-[#6c3040] hover:text-[#f0d875]"
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" /> Prev
                    </Button>
                    <span className="text-xs text-[#fff8df]/70">Live presentation</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={viewerSlide >= currentSlide}
                      onClick={() => setViewerSlide(slide => Math.min(currentSlide, slide + 1))}
                      className="text-[#fff8df] hover:bg-[#6c3040] hover:text-[#f0d875]"
                    >
                      Next <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── Admin Dashboard ──────────────────────────────────────────────────────────
function AdminDashboard({ onSignOut }: { onSignOut: () => void }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'converting' | 'ready' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [presentationId, setPresentationId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [deletingPresentationId, setDeletingPresentationId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [publishingPresentationId, setPublishingPresentationId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [generatingQuizId, setGeneratingQuizId] = useState<string | null>(null);
  const [quizMessage, setQuizMessage] = useState<string | null>(null);
  const [openResultsId, setOpenResultsId] = useState<string | null>(null);
  const [resultsByPresentation, setResultsByPresentation] = useState<Record<string, Array<{
    id: string;
    studentName: string;
    score: number;
    totalQuestions: number;
    createdAt: string;
  }>>>({});
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [renamingPresentationId, setRenamingPresentationId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [stoppingLiveId, setStoppingLiveId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { mutateAsync: requestUrl } = useRequestUploadUrl();
  const { mutateAsync: createPres } = useCreatePresentation();
  const { mutateAsync: convertPres } = useConvertPresentation();
  const { mutateAsync: deletePresentation } = useDeletePresentation();
  const { mutateAsync: publishPresentation } = usePublishPresentation();
  const { mutateAsync: generateQuiz } = useGeneratePresentationQuiz();
  const { mutateAsync: getQuizResults } = useGetQuizResults();
  const { mutateAsync: updatePresentation } = useUpdatePresentation();
  const { mutateAsync: stopLiveMutation } = useSetPresentationLive();
  const { data: allPresentations, refetch: refetchList } = useListPresentations();

  // Wrong presenter password only surfaces once a real admin request hits
  // the server (see lib/admin-auth.ts) — when it does, bounce back to the
  // gate instead of leaving the dashboard silently broken.
  const handleAdminAuthFailure = (err: unknown): boolean => {
    if (!isAuthError(err)) return false;
    clearAdminPassword();
    window.alert('Incorrect presenter password. Please sign in again.');
    onSignOut();
    return true;
  };

  const { data: currentPres, refetch: refetchCurrentPres } = useGetPresentation(presentationId || '', {
    query: {
      enabled: !!presentationId && uploadStatus === 'converting',
      refetchInterval: () => uploadStatus === 'converting' ? 2000 : false,
      queryKey: presentationId ? getGetPresentationQueryKey(presentationId) : ['dummy']
    }
  });

  useEffect(() => {
    if (currentPres) {
      if (currentPres.status === 'ready') {
        setUploadStatus('ready');
        setProgress(100);
        refetchList();
        queryClient.invalidateQueries({ queryKey: ['listPresentations'] });
      } else if (currentPres.status === 'error') {
        setUploadStatus('error');
      }
    }
  }, [currentPres, refetchList, queryClient]);

  const selectFile = (selected?: File) => {
    if (selected) {
      const isSupported =
        selected.type === 'application/pdf' ||
        selected.type === 'application/x-pdf' ||
        selected.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        /\.(pdf|pptx)$/i.test(selected.name);

      if (!isSupported) {
        setFile(null);
        setUploadStatus('error');
        return;
      }

      setFile(selected);
      if (!title) setTitle(selected.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    selectFile(e.target.files?.[0]);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    selectFile(e.dataTransfer.files?.[0]);
  };

  const handleUpload = async () => {
    if (!file || !title) return;
    try {
      setUploadStatus('uploading');
      setProgress(10);
      const contentType =
        file.type ||
        (file.name.toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.presentationml.presentation');

      const { uploadURL, objectPath } = await requestUrl({
        data: { name: file.name, size: file.size, contentType }
      });

      setProgress(30);
      const uploadResponse = await fetch(uploadURL, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': contentType }
      });
      if (!uploadResponse.ok) {
        throw new Error(`File upload failed with status ${uploadResponse.status}`);
      }

      setProgress(60);
      const pres = await createPres({
        data: { title, fileName: file.name, fileObjectPath: objectPath, contentType }
      });

      setProgress(80);
      setUploadStatus('converting');
      setPresentationId(pres.id);

      await convertPres({ id: pres.id });
    } catch (err) {
      console.error(err);
      setUploadStatus('error');
    }
  };

  const resetUpload = () => {
    setFile(null);
    setTitle('');
    setUploadStatus('idle');
    setProgress(0);
    setPresentationId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePublish = async (id: string, presentationTitle: string, published: boolean) => {
    if (!published && !window.confirm(`Publish "${presentationTitle}" to the audience website?`)) {
      return;
    }

    setPublishError(null);
    setPublishingPresentationId(id);
    try {
      await publishPresentation({ id, data: { password: getAdminPassword(), published } });
      await refetchList();
      queryClient.invalidateQueries({ queryKey: getListPresentationsQueryKey() });
      if (presentationId === id) {
        await refetchCurrentPres();
      }
    } catch (err) {
      console.error('Failed to update presentation publishing state', err);
      if (handleAdminAuthFailure(err)) return;
      setPublishError(`Could not ${published ? 'publish' : 'unpublish'} that presentation. Please try again.`);
    } finally {
      setPublishingPresentationId(null);
    }
  };

  const handleDelete = async (id: string, presentationTitle: string) => {
    if (!window.confirm(`Delete "${presentationTitle}"? This will remove the uploaded file permanently.`)) {
      return;
    }

    setDeleteError(null);
    setDeletingPresentationId(id);
    try {
      await deletePresentation({ id, data: { password: getAdminPassword() } });
      await refetchList();
      queryClient.invalidateQueries({ queryKey: getListPresentationsQueryKey() });
      if (presentationId === id) {
        resetUpload();
      }
    } catch (err) {
      console.error('Failed to delete presentation', err);
      if (handleAdminAuthFailure(err)) return;
      setDeleteError('Could not delete that presentation. Please try again.');
    } finally {
      setDeletingPresentationId(null);
    }
  };

  const handleGenerateQuiz = async (id: string, presentationTitle: string) => {
    if (!window.confirm(`Create a new 20-question quiz for "${presentationTitle}"? Any previous quiz results will be reset.`)) {
      return;
    }

    setGeneratingQuizId(id);
    setQuizMessage(null);
    try {
      await generateQuiz({ id, data: { password: getAdminPassword() } });
      setQuizMessage(`Quiz ready for “${presentationTitle}”. Students can now start it from the homepage.`);
    } catch (err) {
      console.error('Failed to generate quiz', err);
      if (handleAdminAuthFailure(err)) return;
      setQuizMessage(`Could not create the quiz for “${presentationTitle}”. Please try again.`);
    } finally {
      setGeneratingQuizId(null);
    }
  };

  const handleViewResults = async (id: string) => {
    if (openResultsId === id) {
      setOpenResultsId(null);
      return;
    }

    setOpenResultsId(id);
    setResultsError(null);
    try {
      const results = await getQuizResults({ id, data: { password: getAdminPassword() } });
      setResultsByPresentation(previous => ({ ...previous, [id]: results }));
    } catch (err) {
      console.error('Failed to load quiz results', err);
      if (handleAdminAuthFailure(err)) return;
      setResultsError('No quiz results are available yet. Create the quiz and have students complete it first.');
    }
  };

  const startRename = (id: string, currentTitle: string) => {
    setRenamingPresentationId(id);
    setRenameTitle(currentTitle);
    setRenameError(null);
  };

  const cancelRename = () => {
    setRenamingPresentationId(null);
    setRenameTitle('');
    setRenameError(null);
  };

  const handleRename = async (id: string) => {
    const nextTitle = renameTitle.trim();
    if (!nextTitle) {
      setRenameError('Enter a presentation title before saving.');
      return;
    }

    try {
      await updatePresentation({ id, data: { password: getAdminPassword(), title: nextTitle } });
      await refetchList();
      queryClient.invalidateQueries({ queryKey: getListPresentationsQueryKey() });
      if (presentationId === id) {
        setTitle(nextTitle);
        await refetchCurrentPres();
      }
      cancelRename();
    } catch (err) {
      console.error('Failed to rename presentation', err);
      if (handleAdminAuthFailure(err)) return;
      setRenameError('Could not rename that presentation. Please try again.');
    }
  };

  const handleStopLive = async (id: string) => {
    setStoppingLiveId(id);
    try {
      await stopLiveMutation({ id, data: { password: getAdminPassword(), live: false } });
      queryClient.invalidateQueries({ queryKey: getListPresentationsQueryKey() });
      await refetchList();
    } catch (err) {
      console.error('Failed to stop live presentation', err);
      if (handleAdminAuthFailure(err)) return;
    } finally {
      setStoppingLiveId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      <header className="border-b border-[#d8bf5e]/50 bg-[#843b49] sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandLogo />
            <Badge variant="outline" className="text-xs text-[#f0d875] border-[#d8bf5e]/60 bg-[#843b49]">Admin</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={onSignOut} className="text-muted-foreground text-xs">
            Sign out
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-6 py-12 space-y-16 max-w-5xl">

        {/* Upload Section */}
        <section className="space-y-6">
          <div className="space-y-2 text-center max-w-2xl mx-auto">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">Stage your next presentation.</h1>
            <p className="text-lg text-muted-foreground">Upload your deck, get a link, and drive the slides for everyone in real-time. PDF format highly recommended.</p>
          </div>

          <Card className="max-w-2xl mx-auto border-border/50 shadow-2xl bg-card/50 backdrop-blur-sm">
            <CardContent className="p-8 space-y-8">

              {uploadStatus === 'idle' && (
                <div className="space-y-6 animate-in fade-in duration-500">
                  <div
                    className={`border-2 border-dashed transition-colors rounded-xl p-10 flex flex-col items-center justify-center text-center cursor-pointer bg-black/20 ${
                      isDragging ? 'border-primary bg-primary/10' : 'border-border/60 hover:border-primary/50'
                    }`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <UploadCloud className="w-12 h-12 text-muted-foreground mb-4" />
                    <p className="text-sm font-medium mb-1">{isDragging ? 'Drop your presentation here' : 'Click to browse or drag and drop'}</p>
                    <p className="text-xs text-muted-foreground">Supports .PDF and .PPTX</p>
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                      onChange={handleFileChange}
                    />
                  </div>

                  {file && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 p-4 rounded-lg border border-border/50 bg-black/20">
                        <FileIcon className="w-8 h-8 text-primary" />
                        <div className="flex-1 overflow-hidden">
                          <p className="text-sm font-medium truncate">{file.name}</p>
                          <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setFile(null); }}>
                          <span className="sr-only">Remove</span>&times;
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="title">Presentation Title</Label>
                        <Input
                          id="title"
                          value={title}
                          onChange={e => setTitle(e.target.value)}
                          placeholder="e.g. Q3 All Hands"
                          className="bg-black/20"
                        />
                      </div>

                      <Button className="w-full h-12 text-md font-semibold" onClick={handleUpload} disabled={!title || !file}>
                        Upload & Prepare
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {(uploadStatus === 'uploading' || uploadStatus === 'converting') && (
                <div className="py-12 space-y-6 text-center animate-in fade-in zoom-in-95 duration-500">
                  <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
                  <div className="space-y-2">
                    <h3 className="text-xl font-semibold">{uploadStatus === 'uploading' ? 'Uploading file...' : 'Processing slides...'}</h3>
                    <p className="text-sm text-muted-foreground">This will just take a moment</p>
                  </div>
                  <Progress value={progress} className="w-full max-w-sm mx-auto h-2" />
                </div>
              )}

              {uploadStatus === 'ready' && currentPres && (
                <div className="py-8 space-y-8 animate-in fade-in zoom-in-95 duration-500">
                  <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto">
                    <PlayCircle className="w-8 h-8 text-primary" />
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="text-2xl font-bold">Ready to Present</h3>
                    <p className="text-muted-foreground">{currentPres.title}</p>
                  </div>
                  <div className="rounded-lg border border-[#d8bf5e]/30 bg-[#843b49]/30 p-4 text-center">
                    <p className="text-sm font-semibold text-[#f0d875]">
                      {currentPres.isPublished ? 'Visible on the homepage' : 'Ready to publish'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {currentPres.isPublished
                        ? 'The presentation is listed on the homepage. Enter the booth to make it live.'
                        : 'Publish this presentation when you are ready to list it on the homepage.'}
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      className="flex-1 h-12"
                      variant={currentPres.isPublished ? 'secondary' : 'default'}
                      onClick={() => handlePublish(currentPres.id, currentPres.title, !currentPres.isPublished)}
                      disabled={publishingPresentationId === currentPres.id}
                    >
                      {publishingPresentationId === currentPres.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      {currentPres.isPublished ? 'Remove from Homepage' : 'Publish to Homepage'}
                    </Button>
                    <Button className="flex-1 h-12" onClick={() => setLocation(`/present/${currentPres.id}`)}>
                      Enter Presenter Booth
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                    <Button variant="ghost" className="h-12" onClick={resetUpload}>Upload Another</Button>
                  </div>
                </div>
              )}

              {uploadStatus === 'error' && (
                <div className="py-12 space-y-6 text-center animate-in fade-in zoom-in-95 duration-500">
                  <div className="w-16 h-16 bg-destructive/20 rounded-full flex items-center justify-center mx-auto">
                    <span className="text-destructive text-2xl font-bold">!</span>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-semibold">Something went wrong</h3>
                    <p className="text-sm text-muted-foreground">We couldn't process your presentation.</p>
                  </div>
                  <Button variant="outline" onClick={resetUpload}>Try Again</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Manage Presentations */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold tracking-tight">All Presentations</h2>
          {deleteError && (
            <p className="text-sm font-medium text-destructive">{deleteError}</p>
          )}
          {publishError && (
            <p className="text-sm font-medium text-destructive">{publishError}</p>
          )}
          {quizMessage && (
            <p className="text-sm font-medium text-[#843b49]">{quizMessage}</p>
          )}
          {resultsError && (
            <p className="text-sm font-medium text-destructive">{resultsError}</p>
          )}
          {renameError && (
            <p className="text-sm font-medium text-destructive">{renameError}</p>
          )}
          {!allPresentations ? (
            <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : allPresentations.length === 0 ? (
            <div className="text-center p-12 border border-dashed border-border/50 rounded-xl bg-card/20">
              <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No presentations yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allPresentations.map(pres => (
                <Card key={pres.id} className="bg-card/40 hover:bg-card/60 transition-colors border-border/40 group">
                  <CardContent className="p-5 flex flex-col gap-4">
                    <div>
                      <div className={`mb-2 flex items-start justify-between gap-2 ${renamingPresentationId === pres.id ? 'flex-col' : ''}`}>
                        {renamingPresentationId === pres.id ? (
                          <div className="flex w-full min-w-0 items-center gap-2">
                            <Input
                              value={renameTitle}
                              onChange={event => setRenameTitle(event.target.value)}
                              onKeyDown={event => {
                                if (event.key === 'Enter') void handleRename(pres.id);
                                if (event.key === 'Escape') cancelRename();
                              }}
                              maxLength={200}
                              autoFocus
                              className="h-10 min-w-0 flex-1 bg-background/70 px-3 text-base"
                              aria-label={`Rename ${pres.title}`}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 shrink-0 text-green-700 hover:bg-green-500/10 hover:text-green-700"
                              onClick={() => void handleRename(pres.id)}
                              aria-label="Save presentation name"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 shrink-0 text-muted-foreground"
                              onClick={cancelRename}
                              aria-label="Cancel renaming"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex min-w-0 items-start gap-1.5">
                            <h3 className="font-semibold line-clamp-2" title={pres.title}>{pres.title}</h3>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-[#843b49]"
                              onClick={() => startRename(pres.id, pres.title)}
                              aria-label={`Rename ${pres.title}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          <Badge variant={pres.status === 'ready' ? 'default' : 'secondary'} className="capitalize">
                            {pres.status}
                          </Badge>
                          {pres.isPublished && (
                            <Badge className="border-[#d8bf5e]/40 bg-[#f0d875]/15 text-[#f0d875]">
                              Published
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{new Date(pres.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 border-t border-border/30 pt-2">
                      {/* Stop Live — visible whenever the presentation is stuck as live */}
                      {pres.isLive && (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="col-span-2 text-xs gap-1.5 animate-pulse"
                          onClick={() => handleStopLive(pres.id)}
                          disabled={stoppingLiveId === pres.id}
                        >
                          {stoppingLiveId === pres.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <StopCircle className="h-3.5 w-3.5" />}
                          {stoppingLiveId === pres.id ? 'Stopping…' : 'Stop Live Presentation'}
                        </Button>
                      )}
                      <Button variant="secondary" size="sm" className="flex-1 text-xs" asChild>
                        <Link href={`/view/${pres.id}`}>View</Link>
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1 text-xs" asChild>
                        <Link href={`/present/${pres.id}`}>Present</Link>
                      </Button>
                      {pres.status === 'ready' && (
                        <Button
                          variant={pres.isPublished ? 'secondary' : 'default'}
                          size="sm"
                          className="col-span-2 text-xs"
                          onClick={() => handlePublish(pres.id, pres.title, !pres.isPublished)}
                          disabled={publishingPresentationId === pres.id}
                        >
                          {publishingPresentationId === pres.id ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          {pres.isPublished ? 'Remove from homepage' : 'Publish to homepage'}
                        </Button>
                      )}
                      {pres.status === 'ready' && (
                        <Button
                          variant="default"
                          size="sm"
                          className="text-xs"
                          onClick={() => handleGenerateQuiz(pres.id, pres.title)}
                          disabled={generatingQuizId === pres.id}
                        >
                          {generatingQuizId === pres.id ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Create Quiz
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => handleViewResults(pres.id)}
                        disabled={openResultsId === pres.id && !resultsByPresentation[pres.id] && !resultsError}
                      >
                        <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
                        {openResultsId === pres.id ? 'Hide Results' : 'Quiz Results'}
                      </Button>
                    </div>
                    {openResultsId === pres.id && resultsByPresentation[pres.id] && (
                      <div className="rounded-lg border border-[#d8bf5e]/30 bg-[#fff8df]/50 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#843b49]">Student results</p>
                          <span className="text-xs text-muted-foreground">{resultsByPresentation[pres.id].length} completed</span>
                        </div>
                        {resultsByPresentation[pres.id].length === 0 ? (
                          <p className="text-xs text-muted-foreground">No students have completed this quiz yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {resultsByPresentation[pres.id].map(result => (
                              <div key={result.id} className="flex items-center justify-between gap-3 border-b border-[#843b49]/10 pb-2 text-xs last:border-0 last:pb-0">
                                <span className="truncate font-medium">{result.studentName}</span>
                                <span className="shrink-0 font-mono text-[#843b49]">
                                  {result.score}/{result.totalQuestions}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => handleDelete(pres.id, pres.title)}
                        disabled={deletingPresentationId === pres.id}
                        aria-label={`Delete ${pres.title}`}
                      >
                        {deletingPresentationId === pres.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────
export default function Home() {
  const [view, setView] = useState<'viewer' | 'gate' | 'admin'>(() => {
    return isAdminUnlocked() ? 'admin' : 'viewer';
  });

  if (view === 'gate') {
    return <AdminPasswordGate onUnlock={() => setView('admin')} onClose={() => setView('viewer')} />;
  }

  if (view === 'admin') {
    return <AdminDashboard onSignOut={() => { clearAdminPassword(); setView('viewer'); }} />;
  }

  return <ViewerLanding onAdminClick={() => setView('gate')} />;
}
