import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, redirect } from "@tanstack/react-router";
import { Providers } from "./providers";
import { Loader } from "./components/ui";
import { sessionMe } from "./lib/auth";
import { Welcome } from "./routes/welcome";
import { Login } from "./routes/login";
import { Register } from "./routes/register";
import { Reset } from "./routes/reset";
import { AppLayout } from "./routes/app-layout";

// The authenticated surface is lazy-loaded so the public/auth first paint stays small.
const Dashboard = lazyRouteComponent(() => import("./routes/dashboard"), "Dashboard");
const AdminHome = lazyRouteComponent(() => import("./routes/admin"), "AdminHome");
const AdminResource = lazyRouteComponent(() => import("./routes/admin-resource"), "AdminResource");
const Profile = lazyRouteComponent(() => import("./routes/profile"), "Profile");
const Notes = lazyRouteComponent(() => import("./routes/notes"), "Notes");
const Shared = lazyRouteComponent(() => import("./routes/shared"), "Shared");

const rootRoute = createRootRoute({ component: () => (<Providers><Outlet /></Providers>) });

const redirectIfAuthed = async () => {
  if (await sessionMe()) throw redirect({ to: "/notes" });
};

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Welcome });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: Login, beforeLoad: redirectIfAuthed });
const registerRoute = createRoute({ getParentRoute: () => rootRoute, path: "/register", component: Register, beforeLoad: redirectIfAuthed });
const resetRoute = createRoute({ getParentRoute: () => rootRoute, path: "/reset", component: Reset });
const sharedRoute = createRoute({ getParentRoute: () => rootRoute, path: "/s/$slug", component: Shared });

// Protected shell — the guard runs before the layout renders; the resolved user is route context.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
  component: AppLayout,
  beforeLoad: async () => {
    const me = await sessionMe();
    if (!me) throw redirect({ to: "/login" });
    return { me };
  },
});
const dashboardRoute = createRoute({ getParentRoute: () => appRoute, path: "/dashboard", component: Dashboard });
const notesRoute = createRoute({ getParentRoute: () => appRoute, path: "/notes", component: Notes });
const adminRoute = createRoute({ getParentRoute: () => appRoute, path: "/admin", component: AdminHome });
const resourceRoute = createRoute({ getParentRoute: () => appRoute, path: "/admin/$resource", component: AdminResource });
const profileRoute = createRoute({ getParentRoute: () => appRoute, path: "/profile", component: Profile });

const routeTree = rootRoute.addChildren([
  indexRoute, loginRoute, registerRoute, resetRoute, sharedRoute,
  appRoute.addChildren([dashboardRoute, notesRoute, adminRoute, resourceRoute, profileRoute]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  // The desktop app's launch loader (spinner ring + wordmark) while a route's
  // beforeLoad (auth check) or a lazy chunk resolves.
  defaultPendingComponent: () => <Loader />,
  defaultPendingMs: 150,
  defaultPendingMinMs: 300,
});

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
