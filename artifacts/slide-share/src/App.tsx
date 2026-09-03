import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home, { ViewerLanding } from '@/pages/home';
import ViewerPage from '@/pages/viewer';
import PresenterPage from '@/pages/presenter';
import QuizPage from '@/pages/quiz';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

/** Dedicated student viewer — always shows ViewerLanding, never admin. */
function StudentViewer() {
  const [, setLocation] = useLocation();
  return <ViewerLanding onAdminClick={() => setLocation('/')} />;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        {/* Shareable student link — always viewer mode */}
        <Route path="/viewer" component={StudentViewer} />
        <Route path="/view/:id" component={ViewerPage} />
        <Route path="/present/:id" component={PresenterPage} />
        <Route path="/quiz/:id" component={QuizPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
