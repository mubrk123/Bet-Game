import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useStore } from "@/lib/store";
import { useEffect, useState, lazy, Suspense } from "react";
import { api } from "@/lib/api";

const Dashboard = lazy(() => import("@/pages/dashboard"));
const Casino = lazy(() => import("@/pages/casino"));
const AdminPanel = lazy(() => import("@/pages/admin"));
const Login = lazy(() => import("@/pages/auth/login"));
const MyBets = lazy(() => import("@/pages/my-bets"));
const Profile = lazy(() => import("@/pages/profile"));
const Withdrawals = lazy(() => import("@/pages/withdrawals"));
const MatchDetail = lazy(() => import("@/pages/match-detail"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageLoader() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
        <p className="mt-4 text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ component: Component, adminOnly = false }: { component: React.ComponentType<any>, adminOnly?: boolean }) {
  const [location, setLocation] = useLocation();
  const currentUser = useStore(state => state.currentUser);

  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (!currentUser) {
      setLocation('/auth/login');
    } else if (adminOnly && !isAdmin) {
      setLocation('/');
    }
  }, [currentUser, location, setLocation, adminOnly, isAdmin]);

  if (!currentUser) return null;
  if (adminOnly && !isAdmin) return null;

  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
}

function Router() {
  const setCurrentUser = useStore(state => state.setCurrentUser);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      try {
        const { user } = await api.getCurrentUser();
        setCurrentUser({
          id: user.id,
          username: user.username,
          role: user.role,
          balance: parseFloat(user.balance),
          exposure: parseFloat(user.exposure),
          currency: user.currency
        });
      } catch (error) {
        setCurrentUser(null);
      } finally {
        setIsChecking(false);
      }
    }

    checkAuth();
  }, [setCurrentUser]);

  if (isChecking) {
    return <PageLoader />;
  }

  return (
    <Switch>
      <Route path="/login">
        {() => {
          window.location.href = '/auth/login';
          return null;
        }}
      </Route>
      <Route path="/auth/login">
        <Suspense fallback={<PageLoader />}>
          <Login />
        </Suspense>
      </Route>
      <Route path="/">
        <ProtectedRoute component={Dashboard} />
      </Route>
      <Route path="/sports">
        <ProtectedRoute component={Dashboard} />
      </Route>
      <Route path="/casino">
        <ProtectedRoute component={Casino} />
      </Route>
      <Route path="/casino/:game">
        <ProtectedRoute component={Casino} />
      </Route>
      <Route path="/profile">
        <ProtectedRoute component={Profile} />
      </Route>
      <Route path="/withdrawals">
        <ProtectedRoute component={Withdrawals} />
      </Route>
      <Route path="/my-bets">
        <ProtectedRoute component={MyBets} />
      </Route>
      <Route path="/match/:id">
        <ProtectedRoute component={MatchDetail} />
      </Route>
      <Route path="/admin">
        <ProtectedRoute component={AdminPanel} adminOnly={true} />
      </Route>
      <Route path="/admin/users">
        <ProtectedRoute component={AdminPanel} adminOnly={true} />
      </Route>
      <Route path="/admin/stats">
        <ProtectedRoute component={AdminPanel} adminOnly={true} />
      </Route>
      <Route>
        <Suspense fallback={<PageLoader />}>
          <NotFound />
        </Suspense>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
