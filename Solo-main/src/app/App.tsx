import { SpeedInsights } from "@vercel/speed-insights/react";
import { createId } from "./utils/id";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Toaster, toast } from "sonner";
import {
  AppState,
  User,
  Quest,
  Habit,
  UserClass,
  Badge,
  FocusSession,
} from "./types";
import {
  saveToStorage,
  loadFromStorage,
  clearStorage,
  loadFromFirebase,
  saveToFirebase,
  flushFirebaseWrites,
} from "./utils/storage";
import { auth, initAnalytics } from "./firebase";
import type { User as FirebaseAuthUser } from "firebase/auth";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  // Added for desktop OAuth flow. On larger screens we use the popup
  // based sign-in to avoid a full page reload. Without this import
  // signInWithPopup would be undefined and cause a runtime error.
  signInWithPopup,
} from "firebase/auth";
import {
  calculateXPForLevel,
  calculateLevel,
  getXPForDifficulty,
} from "./utils/xp";
import { getRandomQuestTemplate } from "./utils/ai";
import { createMockUser, mockQuests, mockHabits, mockBadges } from "./utils/mockData";
import { toLocalDateKey, isoToLocalDateKey, makeDueDateISO } from "./utils/date";

// Pages
import { LandingPage } from "./pages/LandingPage";
import { AuthPage } from "./pages/AuthPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { Dashboard } from "./pages/Dashboard";
import { QuestsPage } from "./pages/QuestsPage";
import { HabitsPage } from "./pages/HabitsPage";
import { FocusSessionPage } from "./pages/FocusSessionPage";
import { RewardsPage } from "./pages/RewardsPage";
import { StatsPage } from "./pages/StatsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { CalendarPage } from "./pages/CalendarPage";

// Components
import { AppSidebar } from "./components/AppSidebar";
import { MobileNav } from "./components/MobileNav";
import { QuestDetailDialog } from "./components/QuestDetailDialog";
import { QuestCreateDialog } from "./components/QuestCreateDialog";
import { CommandPalette } from "./components/CommandPalette";
import { BadgeDetailDialog } from "./components/BadgeDetailDialog";
// Dialog for creating a new habit with custom details. This component
// presents a form allowing the user to set a title, description,
// frequency, XP reward and colour before adding the habit. It falls back
// to native selects on mobile to avoid blank-page issues with Radix
// Select. We import it here so it can be rendered alongside other
// dialogs at the bottom of the component tree.
import { HabitCreateDialog } from "./components/HabitCreateDialog";

export default function App() {
  const [appState, setAppState] = useState<AppState>({
    user: null,
    quests: [],
    habits: [],
    focusSessions: [],
    badges: mockBadges,
    currentPage: "landing",
    isOnboarded: false,
  });

  // Initialize Firebase Analytics once on mount.  This is a no-op in
  // development and will safely bail if analytics is unsupported or
  // disabled.  Calling this here ensures that the analytics SDK is
  // registered before any user interaction occurs.  Errors are caught
  // and logged internally by the helper.
  useEffect(() => {
    // Deliberately not awaiting the result; we only care about side
    // effects.  If analytics cannot be initialized (e.g. due to ad
    // blockers), the promise will reject and we ignore it.
    initAnalytics().catch(() => {});
  }, []);

  // --- Sync guards (prevents race: local save overwriting remote on login) ---
  const canSyncRef = useRef(false);
  const lastSavedSignatureRef = useRef<string>("");
  const lastSavedUserIdRef = useRef<string | null>(null);
  const latestStateRef = useRef<AppState | null>(null);

  useEffect(() => {
    latestStateRef.current = appState;
  }, [appState]);

  const [selectedQuest, setSelectedQuest] = useState<Quest | null>(null);
  const [questDialogOpen, setQuestDialogOpen] = useState(false);

  // Stores the authenticated identity between Auth and Onboarding steps.
  const [pendingAuth, setPendingAuth] = useState<{
    uid: string;
    name: string;
    email: string;
  } | null>(null);

  // Controls visibility of the new quest creation dialog
  const [newQuestDialogOpen, setNewQuestDialogOpen] = useState(false);

  // Optional default due date when opening the quest creation dialog from calendar, etc.
  const [newQuestDefaultDueDate, setNewQuestDefaultDueDate] = useState<string | undefined>(
    undefined
  );

  // Controls visibility of the new habit creation dialog. When true, the
  // HabitCreateDialog is shown allowing the user to customise and create
  // a new habit. This replaces the previous behaviour of immediately
  // adding a default "New Habit". See handleAddHabit below.
  const [newHabitDialogOpen, setNewHabitDialogOpen] = useState(false);

  // Handler invoked when a new habit is created via the HabitCreateDialog.
  // It appends the new habit to state and displays a success toast. The
  // HabitCreateDialog will call this and handle closing itself. Keeping
  // this logic here centralises state updates.
  const handleCreateHabit = (habit: Habit) => {
    setAppState((prev) => ({ ...prev, habits: [...prev.habits, habit] }));
    toast.success("Habit created!");
  };

  // Command palette state (Ctrl/Cmd + K)
  const [commandOpen, setCommandOpen] = useState(false);

  // Badge dialog state
  const [selectedBadge, setSelectedBadge] = useState<Badge | null>(null);
  const [badgeDialogOpen, setBadgeDialogOpen] = useState(false);

  // Mobile drawer menu (hamburger)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  /**
   * Shared helper for OAuth (Google/Facebook) + Email/Password flows.
   * Decides whether to load existing remote state or send the user to onboarding.
   */
  async function completeLoginFromFirebaseUser(fbUser: FirebaseAuthUser, overrideName?: string) {
    const uid = fbUser.uid;
    const email = fbUser.email || `${uid}@oauth.local`;
    const resolvedName = overrideName || fbUser.displayName || email.split("@")[0] || "Hero";

    const remoteState = await loadFromFirebase(uid);
    if (remoteState && remoteState.user) {
      setPendingAuth(null);
      setAppState({
        ...remoteState,
        currentPage: "dashboard",
        isOnboarded: true,
      });
      toast.success(`Welcome back, ${remoteState.user.name}!`, {
        description: "Your data has been loaded from Firebase.",
      });
      return;
    }

    setPendingAuth({ uid, name: resolvedName, email });
    setAppState((prev) => ({ ...prev, currentPage: "onboarding" }));
  }

  const handleOAuth = async (providerName: "google" | "facebook") => {
    try {
      const provider =
        providerName === "google" ? new GoogleAuthProvider() : new FacebookAuthProvider();

      // Facebook sometimes doesn't return email unless requested
      if (providerName === "facebook") {
        (provider as FacebookAuthProvider).addScope("email");
      }

      /**
       * Use a popup for OAuth on larger screens (desktop). On many mobile
       * browsers the popup can be blocked, so we fall back to the redirect
       * flow on small viewports. After a successful popup sign-in we
       * immediately complete the login locally, avoiding a full page reload.
       */
      const isSmallScreen = typeof window !== "undefined" && window.innerWidth < 640;
      if (!isSmallScreen) {
        // Use popup on desktop so we can complete login without redirecting
        const result = await signInWithPopup(auth, provider);
        if (result.user) {
          await completeLoginFromFirebaseUser(result.user);
        }
      } else {
        // Fallback to redirect flow on mobile
        await signInWithRedirect(auth, provider);
      }
    } catch (err: any) {
      const code = err?.code as string | undefined;
      if (code === "auth/unauthorized-domain") {
        const host = typeof window !== "undefined" ? window.location.hostname : "(unknown host)";
        toast.error("Domain belum diizinkan", {
          description:
            `Tambahkan domain ini ke Firebase Console → Authentication → Settings → Authorized domains: ${host}`,
        });
      } else if (code === "auth/operation-not-allowed") {
        toast.error("Provider belum diaktifkan", {
          description:
            "Aktifkan Google/Facebook di Firebase Console → Authentication → Sign-in method.",
        });
      } else {
        toast.error("Login gagal", { description: err?.message || "Gagal login dengan provider." });
      }
      console.error("OAuth error:", err);
    }
  };

  // Load from storage on mount
  useEffect(() => {
    const savedState = loadFromStorage();
    if (savedState) {
      setAppState(savedState);
      return;
    }

    // If there's no local cache but Firebase auth is already logged in (e.g. returning user),
    // load the remote state directly.
    if (auth.currentUser) {
      completeLoginFromFirebaseUser(auth.currentUser).catch(() => {
        // ignore
      });
    }
  }, []);

  // Complete OAuth sign-in (Google/Facebook) after redirect.
  // We do this once on mount so mobile login is reliable (popup is often blocked).
  useEffect(() => {
    (async () => {
      try {
        const res = await getRedirectResult(auth);
        if (res?.user) {
          await completeLoginFromFirebaseUser(res.user);
        }
      } catch (err) {
        // If there was no redirect, Firebase returns null; errors here usually mean
        // provider isn't enabled or domain isn't authorized.
        console.error("getRedirectResult error:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Catch unexpected runtime errors (common cause of "blank white page" on mobile)
  // and show a friendly toast instead of leaving users confused.
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      console.error("Window error:", event.error || event.message);
      toast.error("Terjadi error", {
        description: "Coba refresh. Kalau masih blank, kirim screenshot error di console.",
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("Unhandled rejection:", event.reason);
      toast.error("Terjadi error", {
        description: "Coba refresh. Kalau masih blank, kirim screenshot error di console.",
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  // Global shortcut: Ctrl/Cmd + K to open command palette
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Load persisted state from Firebase when a user logs in.
  // IMPORTANT: we gate saving until after this hydration completes, so local state
  // does not overwrite the remote document by accident (common sync race).
  useEffect(() => {
    const uid = appState.user?.id;
    if (!uid) {
      canSyncRef.current = false;
      lastSavedUserIdRef.current = null;
      lastSavedSignatureRef.current = "";
      return;
    }

    let cancelled = false;
    canSyncRef.current = false;
    lastSavedUserIdRef.current = uid;
    lastSavedSignatureRef.current = "";

    async function fetchRemoteState() {
      const remoteState = await loadFromFirebase(uid);
      if (cancelled) return;

      if (remoteState) {
        setAppState({
          ...remoteState,
          // Always land on dashboard after hydration to avoid weird deep-links
          // from stale remote state. Local navigation is still stored in localStorage.
          currentPage: "dashboard",
        });
      }

      canSyncRef.current = true;
    }

    fetchRemoteState().catch((err) => {
      console.error("Remote hydration failed:", err);
      canSyncRef.current = true;
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState.user?.id]);

  // Daily rollover: reset daily quests when the local date changes.
  useEffect(() => {
    if (!appState.user) return;

    const todayKey = toLocalDateKey(new Date());
    setAppState((prev) => {
      if (!prev.user) return prev;
      if (prev.lastDailyReset === todayKey) return prev;

      const now = new Date();
      const updatedQuests = prev.quests.map((q) => {
        if (!q.isDaily) return q;

        return {
          ...q,
          status: "pending" as const,
          completedAt: undefined,
          dueDate: makeDueDateISO(now),
          subtasks: q.subtasks.map((st) => ({ ...st, completed: false })),
        };
      });

      return {
        ...prev,
        quests: updatedQuests,
        lastDailyReset: todayKey,
      };
    });
  }, [appState.user]);

  // Save to storage whenever state changes
  useEffect(() => {
    if (appState.user) {
      saveToStorage(appState);
    }
  }, [appState]);

  // Persist to Firebase whenever state changes and user is present
  // - gated by hydration (canSyncRef)
  // - debounced inside saveToFirebase
  // - signature check so page navigation does not spam writes
  useEffect(() => {
    const uid = appState.user?.id;
    if (!uid) return;
    if (!canSyncRef.current) return;

    // Remote doc does not need UI-only navigation state
    const stateForRemote: AppState = { ...appState, currentPage: "dashboard" };

    if (lastSavedUserIdRef.current !== uid) {
      lastSavedUserIdRef.current = uid;
      lastSavedSignatureRef.current = "";
    }

    const signature = JSON.stringify(stateForRemote);
    if (signature === lastSavedSignatureRef.current) return;
    lastSavedSignatureRef.current = signature;

    // Fire-and-forget (debounced); errors are logged inside storage.ts
    saveToFirebase(uid, stateForRemote).catch(() => {});
  }, [appState]);

  // Flush pending Firestore writes on app background/close (more reliable on mobile)
  useEffect(() => {
    const uid = appState.user?.id;
    if (!uid) return;

    const flush = () => {
      flushFirebaseWrites(uid).catch(() => {});
    };

    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };

    const onOnline = () => {
      const state = latestStateRef.current;
      if (!state) return;
      if (!canSyncRef.current) return;
      const remoteState: AppState = { ...state, currentPage: "dashboard" };
      saveToFirebase(uid, remoteState).catch(() => {});
    };

    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);

    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
    };
  }, [appState.user?.id]);

  // Auth & Onboarding Handlers
  const handleAuth = async (
    name: string,
    email: string,
    password: string,
    isSignup: boolean
  ) => {
    try {
      const cred = isSignup
        ? await createUserWithEmailAndPassword(auth, email, password)
        : await signInWithEmailAndPassword(auth, email, password);

      if (isSignup && name) {
        await updateProfile(cred.user, { displayName: name });
      }

      // Reuse the same logic as OAuth login: load remote state if it exists,
      // otherwise continue to onboarding.
      await completeLoginFromFirebaseUser(cred.user, name || undefined);
    } catch (err: any) {
      const code = err?.code as string | undefined;
      const message =
        code === "auth/invalid-login-credentials"
          ? "Email atau password salah."
          : code === "auth/email-already-in-use"
          ? "Email ini sudah terdaftar. Coba Sign In."
          : code === "auth/weak-password"
          ? "Password terlalu lemah (minimal 6 karakter)."
          : code === "auth/operation-not-allowed"
          ? "Provider Auth belum diaktifkan di Firebase Console (Enable Email/Password di Authentication)."
          : err?.message || "Gagal login.";

      toast.error("Login gagal", { description: message });
      console.error("Firebase Auth error:", err);
    }
  };

  const handleOnboardingComplete = (userClass: UserClass, goal: string, schedule: string[]) => {
    const newUser = createMockUser(
      pendingAuth?.name || "Hero",
      pendingAuth?.email || "hero@levelday.com",
      userClass
    );
    if (pendingAuth?.uid) {
      newUser.id = pendingAuth.uid;
    }
    newUser.dailyGoal = goal;
    newUser.weeklySchedule = schedule;

    setAppState((prev) => ({
      ...prev,
      user: newUser,
      quests: mockQuests,
      habits: mockHabits,
      isOnboarded: true,
      currentPage: "dashboard",
    }));

    setPendingAuth(null);

    toast.success(`Welcome, ${userClass.charAt(0).toUpperCase() + userClass.slice(1)}!`, {
      description: "Your journey begins now",
    });
  };

  // Navigation
  const handleNavigate = (page: string) => {
    setAppState((prev) => ({ ...prev, currentPage: page }));
  };

  const handleBadgeClick = (badge: Badge) => {
    setSelectedBadge(badge);
    setBadgeDialogOpen(true);
  };

  const checkAndUnlockBadges = (state: AppState): Badge[] => {
    return state.badges.map((badge) => {
      if (!badge.isLocked) return badge;
      if (!state.user) return badge;

      const completedQuestsCount = state.quests.filter((q) => q.status === "completed").length;
      const completedFocusSessions = state.focusSessions.filter((fs) => fs.completed).length;

      let unlock = false;
      const requirement = badge.requirement?.toLowerCase() || "";

      if (requirement.includes("complete 1 quest") && completedQuestsCount >= 1) unlock = true;
      else if (requirement.includes("7-day streak") && state.habits.some((h) => h.longestStreak >= 7))
        unlock = true;
      else if (requirement.includes("50 quests") && completedQuestsCount >= 50) unlock = true;
      else if (requirement.includes("100 focus sessions") && completedFocusSessions >= 100)
        unlock = true;
      else if (requirement.includes("level 50") && state.user.level >= 50) unlock = true;

      if (unlock) {
        return {
          ...badge,
          isLocked: false,
          unlockedAt: new Date().toISOString(),
        };
      }
      return badge;
    });
  };

  // Quest Handlers
  const handleAddQuestAI = () => {
    const template = getRandomQuestTemplate();
    const newQuest: Quest = {
      id: createId("quest"),
      title: template.title,
      description: template.description,
      difficulty: template.difficulty,
      status: "pending",
      xpReward: getXPForDifficulty(template.difficulty),
      tags: template.tags || [],
      subtasks: [],
      createdAt: new Date().toISOString(),
    };
    setAppState((prev) => ({
      ...prev,
      quests: [...prev.quests, newQuest],
    }));
    toast.success("AI quest created!", { description: "A new challenge has been selected for you" });
  };

  const handleCreateQuest = (quest: Quest) => {
    setAppState((prev) => ({
      ...prev,
      quests: [...prev.quests, quest],
    }));
    toast.success("Quest created!", { description: "Time to start your adventure" });
  };

  const handleOpenNewQuestDialog = (dueDateISO?: string) => {
    setNewQuestDefaultDueDate(dueDateISO);
    setNewQuestDialogOpen(true);
  };

  const handleCompleteQuest = (questId: string) => {
    const quest = appState.quests.find((q) => q.id === questId);
    if (!quest || !appState.user) return;

    const updatedQuests = appState.quests.map((q) =>
      q.id === questId ? { ...q, status: "completed" as const, completedAt: new Date().toISOString() } : q
    );

    const newTotalXP = appState.user.totalXP + quest.xpReward;
    const newLevel = calculateLevel(newTotalXP);
    const leveledUp = newLevel > appState.user.level;

    let xpForCurrentLevel = 0;
    for (let i = 1; i < newLevel; i++) xpForCurrentLevel += calculateXPForLevel(i);
    const currentXP = newTotalXP - xpForCurrentLevel;
    const xpToNextLevel = calculateXPForLevel(newLevel);

    const updatedUser: User = {
      ...appState.user,
      xp: currentXP,
      xpToNextLevel,
      level: newLevel,
      totalXP: newTotalXP,
    };

    const newState: AppState = { ...appState, user: updatedUser, quests: updatedQuests };
    const updatedBadges = checkAndUnlockBadges(newState);
    setAppState({ ...newState, badges: updatedBadges });

    if (leveledUp) {
      toast.success(`🎉 Level Up! You're now Level ${newLevel}!`, { description: `You earned ${quest.xpReward} XP` });
    } else {
      toast.success(`Quest Complete! +${quest.xpReward} XP`, {
        description: `${xpToNextLevel - currentXP} XP until Level ${newLevel + 1}`,
      });
    }
  };

  const handleOpenQuestDetail = (quest: Quest) => {
    setSelectedQuest(quest);
    setQuestDialogOpen(true);
  };

  const handleCloseQuestDetail = () => setQuestDialogOpen(false);

  // Habit Handlers
  /**
   * Opens the habit creation dialog instead of immediately creating a
   * habit. Users can customise the habit details (title, description,
   * frequency, XP reward and colour) before it is added to the state.
   */
  const handleAddHabit = () => {
    setNewHabitDialogOpen(true);
  };

  const handleToggleHabit = (habitId: string) => {
    const todayStr = new Date().toISOString().split("T")[0];
    const habit = appState.habits.find((h) => h.id === habitId);
    if (!habit || !appState.user) return;

    const isCompletedToday = habit.completedDates.some((date) => date.startsWith(todayStr));

    if (isCompletedToday) {
      const updatedHabits = appState.habits.map((h) =>
        h.id === habitId
          ? {
              ...h,
              completedDates: h.completedDates.filter((d) => !d.startsWith(todayStr)),
              currentStreak: Math.max(0, h.currentStreak - 1),
            }
          : h
      );
      const newState: AppState = { ...appState, habits: updatedHabits };
      const updatedBadges = checkAndUnlockBadges(newState);
      setAppState({ ...newState, badges: updatedBadges });
      toast.info("Habit unmarked");
    } else {
      const newStreak = habit.currentStreak + 1;
      const longestStreak = Math.max(habit.longestStreak, newStreak);

      const updatedHabits = appState.habits.map((h) =>
        h.id === habitId
          ? {
              ...h,
              completedDates: [...h.completedDates, new Date().toISOString()],
              currentStreak: newStreak,
              longestStreak,
            }
          : h
      );

      const newTotalXP = appState.user.totalXP + habit.xpPerCompletion;
      const newLevel = calculateLevel(newTotalXP);

      let xpForCurrentLevel = 0;
      for (let i = 1; i < newLevel; i++) xpForCurrentLevel += calculateXPForLevel(i);
      const currentXP = newTotalXP - xpForCurrentLevel;
      const xpToNextLevel = calculateXPForLevel(newLevel);

      const updatedUser: User = {
        ...appState.user,
        xp: currentXP,
        xpToNextLevel,
        level: newLevel,
        totalXP: newTotalXP,
      };

      const newState: AppState = { ...appState, user: updatedUser, habits: updatedHabits };
      const updatedBadges = checkAndUnlockBadges(newState);
      setAppState({ ...newState, badges: updatedBadges });

      toast.success(`Habit complete! +${habit.xpPerCompletion} XP`, {
        description: newStreak > 1 ? `${newStreak} day streak! 🔥` : undefined,
      });
    }
  };

  // Focus Session Handler
  const handleFocusComplete = (duration: number, xpEarned: number) => {
    if (!appState.user) return;

    const newTotalXP = appState.user.totalXP + xpEarned;
    const newLevel = calculateLevel(newTotalXP);

    let xpForCurrentLevel = 0;
    for (let i = 1; i < newLevel; i++) xpForCurrentLevel += calculateXPForLevel(i);
    const currentXP = newTotalXP - xpForCurrentLevel;
    const xpToNextLevel = calculateXPForLevel(newLevel);

    const updatedUser: User = {
      ...appState.user,
      xp: currentXP,
      xpToNextLevel,
      level: newLevel,
      totalXP: newTotalXP,
    };

    const newFocusSession: FocusSession = {
      id: createId("focus"),
      duration,
      startTime: new Date(Date.now() - duration * 60 * 1000).toISOString(),
      endTime: new Date().toISOString(),
      xpEarned,
      completed: true,
    };

    const newState: AppState = {
      ...appState,
      user: updatedUser,
      focusSessions: [...appState.focusSessions, newFocusSession],
    };
    const updatedBadges = checkAndUnlockBadges(newState);
    setAppState({ ...newState, badges: updatedBadges });

    toast.success(`Focus session complete! +${xpEarned} XP`, {
      description: `You focused for ${duration} minutes`,
    });
  };

  // Settings Handlers
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      // Even if signOut fails, we still clear local app state.
      console.warn("signOut failed:", err);
    }

    clearStorage();
    setPendingAuth(null);
    setAppState({
      user: null,
      quests: [],
      habits: [],
      focusSessions: [],
      badges: mockBadges,
      currentPage: "landing",
      isOnboarded: false,
    });
    toast.info("Logged out successfully");
  };

  const handleUpdateProfile = (name: string, email: string) => {
    if (!appState.user) return;
    setAppState((prev) => ({ ...prev, user: { ...prev.user!, name, email } }));
    toast.success("Profile updated!");
  };

  // Render current page
  const renderPage = () => {
    switch (appState.currentPage) {
      case "landing":
        return <LandingPage onGetStarted={() => handleNavigate("auth")} />;

      case "auth":
        return <AuthPage onAuth={handleAuth} onOAuth={handleOAuth} />;

      case "onboarding":
        return <OnboardingPage onComplete={handleOnboardingComplete} />;

      case "dashboard": {
        if (!appState.user) return null;
        const todayKey = toLocalDateKey(new Date());
        const todayQuestsAll = appState.quests.filter((q) => {
          if (!q.dueDate) return true;
          const dueKey = isoToLocalDateKey(q.dueDate);
          return dueKey ? dueKey === todayKey : true;
        });
        const todayQuests = todayQuestsAll.filter((q) => q.status !== "completed");

        return (
          <Dashboard
            user={appState.user}
            todayQuestsAll={todayQuestsAll}
            todayQuests={todayQuests}
            habits={appState.habits}
            onAddQuest={() => handleOpenNewQuestDialog()}
            onAddQuestAI={handleAddQuestAI}
            onQuestClick={(quest) => handleOpenQuestDetail(quest)}
            onQuestComplete={(questId) => handleCompleteQuest(questId)}
            onViewAllQuests={() => handleNavigate("quests")}
            onViewAllHabits={() => handleNavigate("habits")}
            moodToday={appState.moodByDate?.[todayKey]}
            onMoodChange={(mood) => {
              setAppState((prev) => ({
                ...prev,
                moodByDate: {
                  ...(prev.moodByDate || {}),
                  [todayKey]: mood,
                },
              }));
              toast.success("Mood saved", { description: `Mood hari ini: ${mood}` });
            }}
            onHabitClick={(habit) => handleToggleHabit(habit.id)}
            onStartFocus={() => handleNavigate("focus")}
          />
        );
      }

      case "quests":
        return (
          <QuestsPage
            quests={appState.quests}
            onAddQuest={() => handleOpenNewQuestDialog()}
            onAddQuestAI={handleAddQuestAI}
            onQuestClick={(quest) => handleOpenQuestDetail(quest)}
            onCompleteQuest={handleCompleteQuest}
          />
        );

      case "calendar":
        return (
          <CalendarPage
            quests={appState.quests}
            onQuestClick={handleOpenQuestDetail}
            onCompleteQuest={handleCompleteQuest}
            onAddQuestForDate={(date) => handleOpenNewQuestDialog(makeDueDateISO(date))}
          />
        );

      case "habits":
        return (
          <HabitsPage
            habits={appState.habits}
            onAddHabit={handleAddHabit}
            onHabitClick={() => {}}
            onToggleHabit={handleToggleHabit}
          />
        );

      case "focus":
        return <FocusSessionPage onComplete={handleFocusComplete} />;

      case "rewards":
        return <RewardsPage badges={appState.badges} onBadgeClick={handleBadgeClick} />;

      case "stats":
        return (
          <StatsPage
            quests={appState.quests}
            habits={appState.habits}
            focusSessions={appState.focusSessions}
            moodByDate={appState.moodByDate}
          />
        );

      case "settings":
        if (!appState.user) return null;
        return <SettingsPage user={appState.user} onLogout={handleLogout} onUpdateProfile={handleUpdateProfile} />;

      default:
        return null;
    }
  };

  const isAppPage = appState.user && appState.isOnboarded;

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      {isAppPage ? (
        <div className="flex overflow-x-hidden">
          {/* Mobile Topbar */}
          <div className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between border-b bg-background/80 backdrop-blur px-4 py-3 md:hidden">
            <button className="rounded border px-3 py-2" onClick={() => setMobileMenuOpen(true)}>
              ☰ Menu
            </button>
            <div className="font-semibold">Solo</div>
            <div className="w-16" />
          </div>

          {/* Mobile Drawer */}
          {mobileMenuOpen && (
            <div className="fixed inset-0 z-50 md:hidden">
              <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
              <div className="absolute left-0 top-0 h-full w-72 bg-background p-4 overflow-y-auto">
                <button className="mb-4 rounded border px-3 py-2" onClick={() => setMobileMenuOpen(false)}>
                  Close
                </button>

                <AppSidebar
                  user={appState.user!}
                  currentPage={appState.currentPage}
                  onNavigate={(p) => {
                    handleNavigate(p);
                    setMobileMenuOpen(false);
                  }}
                  onAddQuest={() => {
                    handleOpenNewQuestDialog();
                    setMobileMenuOpen(false);
                  }}
                />
              </div>
            </div>
          )}

          {/* Desktop Sidebar */}
          <div className="hidden md:block">
            <AppSidebar
              user={appState.user!}
              currentPage={appState.currentPage}
              onNavigate={handleNavigate}
              onAddQuest={() => handleOpenNewQuestDialog()}
            />
          </div>

          {/* Main Content */}
          <div className="flex-1 min-w-0 min-h-screen pb-20 md:pb-0">
            <div className="container mx-auto max-w-7xl px-4 py-4 pt-16 sm:px-6 sm:py-6 md:pt-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={appState.currentPage}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  {renderPage()}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Mobile Bottom Nav */}
          <MobileNav currentPage={appState.currentPage} onNavigate={handleNavigate} />
        </div>
      ) : (
        <div>{renderPage()}</div>
      )}

      <Toaster
        position="top-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "rgba(18, 19, 31, 0.9)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(139, 92, 246, 0.2)",
            color: "#e8e9f3",
          },
        }}
      />

      {isAppPage && (
        <CommandPalette
          open={commandOpen}
          onOpenChange={setCommandOpen}
          quests={appState.quests}
          onNavigate={handleNavigate}
          onNewQuest={() => handleOpenNewQuestDialog()}
          onNewAIQuest={handleAddQuestAI}
          onStartFocus={() => handleNavigate("focus")}
        />
      )}

      <QuestDetailDialog
        quest={selectedQuest}
        open={questDialogOpen}
        onClose={handleCloseQuestDetail}
        onSave={(updatedQuest) => {
          setAppState((prev) => ({
            ...prev,
            quests: prev.quests.map((q) => (q.id === updatedQuest.id ? updatedQuest : q)),
          }));
          toast.success("Quest updated!");
        }}
        onComplete={handleCompleteQuest}
        onDelete={(questId) => {
          setAppState((prev) => ({
            ...prev,
            quests: prev.quests.filter((q) => q.id !== questId),
          }));
          toast.success("Quest deleted");
        }}
      />

      <BadgeDetailDialog badge={selectedBadge} open={badgeDialogOpen} onClose={() => setBadgeDialogOpen(false)} />

      <QuestCreateDialog
        open={newQuestDialogOpen}
        defaultDueDate={newQuestDefaultDueDate}
        onClose={() => {
          setNewQuestDialogOpen(false);
          setNewQuestDefaultDueDate(undefined);
        }}
        onCreate={handleCreateQuest}
      />

      {/* Habit creation dialog */}
      <HabitCreateDialog
        open={newHabitDialogOpen}
        onClose={() => setNewHabitDialogOpen(false)}
        onCreate={handleCreateHabit}
      />

      {/* Vercel Speed Insights */}
      <SpeedInsights />
    </div>
  );
}
