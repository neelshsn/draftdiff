import {
    Component,
    Match,
    Show,
    Switch,
    createEffect,
    createSignal,
    createMemo,
} from "solid-js";
import { formatDistance } from "date-fns";
import { Icon } from "solid-heroicons";
import { funnel, adjustmentsHorizontal, cog_6Tooth } from "solid-heroicons/solid";
import DraftView from "./components/views/draft/DraftView";
import { useUser } from "./contexts/UserContext";
import { useDataset } from "./contexts/DatasetContext";
import { useLolClient } from "./contexts/LolClientContext";
import { useDraftAnalysis } from "./contexts/DraftAnalysisContext";
import { useDraft } from "./contexts/DraftContext";
import { ratingToWinrate } from "@draftgap/core/src/rating/ratings";
import { buttonVariants } from "./components/common/Button";
import { cn } from "./utils/style";
import { NEUTRAL_COLORS, hexToRgba } from "./utils/neonTheme";
import { useDraftNeonThemes } from "./utils/useDraftTheme";
import { Dialog, DialogTrigger } from "./components/common/Dialog";
import SettingsDialog from "./components/dialogs/SettingsDialog";
import { FAQDialog } from "./components/dialogs/FAQDialog";
import { DesktopAppDialog } from "./components/dialogs/DesktopAppDialog";
import { UpdateDialog } from "./components/dialogs/UpdateDialog";
import { Search } from "./components/draft/Search";
import { RoleFilter } from "./components/draft/RoleFilter";
import { LoadingIcon } from "./components/icons/LoadingIcon";
import { FilterDialog } from "./components/draft/FilterDialog";
import { TeamSimulationDialog } from "./components/draft/TeamSimulationDialog";

const App: Component = () => {
    const { config } = useUser();
    const { startLolClientIntegration, stopLolClientIntegration } =
        useLolClient();
    const { dataset, isLoaded, patchLabel, proTeams } = useDataset();
    const { resetAll } = useDraft();
    const {
        allyDraftAnalysis,
        opponentDraftAnalysis,
        allyDraftEvaluation,
    } = useDraftAnalysis();
    const { activeTheme, advantageTheme } = useDraftNeonThemes();

    createEffect(() => {
        if (config.disableLeagueClientIntegration) {
            stopLolClientIntegration();
        } else {
            startLolClientIntegration();
        }
    });

    const [showSettings, setShowSettings] = createSignal(false);
    const [showFAQ, setShowFAQ] = createSignal(false);
    const [showDownloadModal, setShowDownloadModal] = createSignal(false);
    const [showFilters, setShowFilters] = createSignal(false);
    const [showTeamDialog, setShowTeamDialog] = createSignal(false);

    const timeAgo = () =>
        dataset()
            ? formatDistance(new Date(dataset()!.date), new Date(), {
                  addSuffix: true,
              })
            : "";

    const allyWinrate = () =>
        ratingToWinrate(allyDraftAnalysis()?.totalRating ?? 0);
    const opponentWinrate = () =>
        ratingToWinrate(opponentDraftAnalysis()?.totalRating ?? 0);

    const projectionPercent = () =>
        Number.isFinite(allyWinrate())
            ? Math.round(allyWinrate() * 1000) / 10
            : undefined;

    const deltaPercent = () =>
        Number.isFinite(allyWinrate() - opponentWinrate())
            ? Math.round((allyWinrate() - opponentWinrate()) * 1000) / 10
            : undefined;

    const lookaheadScore = () =>
        Number.isFinite(allyDraftEvaluation()?.totalScore ?? NaN)
            ? Math.round((allyDraftEvaluation()?.totalScore ?? 0) * 100) / 100
            : undefined;

    const showTeamButton = createMemo(
        () => config.dataSource === "pro" && proTeams().length > 0
    );
    const headerStyle = createMemo(() => ({
        background: `linear-gradient(120deg, ${hexToRgba(
            activeTheme().primary,
            0.22
        )} 0%, rgba(10,14,24,0.92) 40%, rgba(8,11,18,0.94) 65%, ${hexToRgba(
            advantageTheme().secondary,
            0.18
        )} 100%)`,
        borderBottom: `1px solid ${hexToRgba(activeTheme().secondary, 0.35)}`,
        boxShadow: `0 24px 60px -28px ${advantageTheme().glow}`,
        backdropFilter: "blur(18px)",
    }));
    const titleStyle = createMemo(() => ({
        color: "#E5F2FF",
        backgroundImage: `linear-gradient(90deg, ${activeTheme().primary}, ${advantageTheme().secondary})`,
        backgroundClip: "text",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        textShadow: `0 0 28px ${hexToRgba(activeTheme().primary, 0.45)}`,
    }));
    const patchBadgeStyle = createMemo(() => ({
        borderColor: hexToRgba(activeTheme().secondary, 0.42),
        background: `linear-gradient(120deg, ${hexToRgba(
            activeTheme().primary,
            0.2
        )} 0%, rgba(8,12,18,0.76) 100%)`,
        color: hexToRgba(NEUTRAL_COLORS.textStrong, 0.92),
        boxShadow: `0 0 18px -8px ${activeTheme().glow}`,
    }));
    const toolbarStyle = createMemo(() => ({
        borderTop: `1px solid ${hexToRgba(activeTheme().secondary, 0.22)}`,
        background: `linear-gradient(120deg, rgba(6,10,16,0.96) 0%, rgba(4,7,12,0.92) 60%, ${hexToRgba(
            advantageTheme().secondary,
            0.12
        )} 100%)`,
    }));
    const mainStyle = createMemo(() => ({
        background: `radial-gradient(circle at 12% 12%, ${hexToRgba(
            activeTheme().primary,
            0.08
        )}, transparent 55%), radial-gradient(circle at 88% 16%, ${hexToRgba(
            advantageTheme().secondary,
            0.08
        )}, transparent 60%), linear-gradient(180deg, rgba(4,7,12,0.95) 0%, rgba(2,3,9,0.98) 55%, rgba(1,2,6,1) 100%)`,
    }));

    const WinrateProjectionBar: Component<{
        value: number | undefined;
        delta: number | undefined;
        lookahead: number | undefined;
    }> = (props) => {
        const value = createMemo<number | undefined>(() => {
            const raw = props.value;
            if (typeof raw === "number" && Number.isFinite(raw)) {
                return Math.min(100, Math.max(0, raw));
            }
            return undefined;
        });
        const delta = createMemo<number | undefined>(() => {
            const raw = props.delta;
            if (typeof raw === "number" && Number.isFinite(raw)) {
                return raw;
            }
            return undefined;
        });
        const lookahead = createMemo<number | undefined>(() => {
            const raw = props.lookahead;
            if (typeof raw === "number" && Number.isFinite(raw)) {
                return raw;
            }
            return undefined;
        });
        const winningSide = createMemo<"ally" | "opponent" | "neutral">(() => {
            const currentDelta = delta();
            if (currentDelta !== undefined && currentDelta !== 0) {
                return currentDelta > 0 ? "ally" : "opponent";
            }
            const currentValue = value();
            if (currentValue !== undefined && currentValue !== 50) {
                return currentValue > 50 ? "ally" : "opponent";
            }
            return "neutral";
        });
        const winningTheme = createMemo(() => {
            const side = winningSide();
            if (side === "ally") return activeTheme();
            if (side === "opponent") return advantageTheme();
            return activeTheme();
        });
        const trackStyle = createMemo(() => ({
            background: `linear-gradient(90deg, rgba(7,11,18,0.85), rgba(4,6,12,0.6))`,
            boxShadow: `inset 0 2px 18px -12px ${hexToRgba(activeTheme().primary, 0.8)}`,
        }));
        const fillStyle = createMemo(() => ({
            background: `linear-gradient(90deg, ${hexToRgba(
                winningTheme().primary,
                0.95
            )}, ${hexToRgba(winningTheme().secondary, 0.95)})`,
            boxShadow: `0 0 18px -6px ${winningTheme().glow}`,
        }));
        const deltaStyle = createMemo(() => ({
            color:
                delta() !== undefined && delta()! < 0
                    ? hexToRgba(advantageTheme().secondary, 0.92)
                    : hexToRgba(activeTheme().primary, 0.92),
            textShadow: `0 0 14px ${winningTheme().glow}`,
        }));

        return (
            <div class="flex w-full max-w-xl flex-col gap-2">
                <div class="flex items-center justify-between text-[10px] uppercase tracking-[0.32em] text-[#8A9FC2]">
                    <span>Projection winrate</span>
                    {delta() !== undefined && (
                        <span
                            class="flex items-center gap-1 font-semibold"
                            style={deltaStyle()}
                        >
                            {delta()! >= 0 ? "+" : "-"}
                            {Math.abs(delta()!).toFixed(1)}%
                        </span>
                    )}
                </div>
                <div class="flex items-center gap-3">
                    <div
                        class="relative h-2 flex-1 overflow-hidden rounded-full"
                        style={trackStyle()}
                    >
                        {value() !== undefined ? (
                            <div
                                class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
                                style={{ width: `${value()}%`, ...fillStyle() }}
                            />
                        ) : (
                            <div class="absolute inset-0 bg-[#1b2335]/70" />
                        )}
                    </div>
                    <div
                        class="text-sm font-semibold"
                        style={{
                            color:
                                winningSide() === "neutral"
                                    ? hexToRgba(NEUTRAL_COLORS.textStrong, 0.88)
                                    : hexToRgba(winningTheme().primary, 0.95),
                            textShadow:
                                winningSide() === "neutral"
                                    ? undefined
                                    : `0 0 12px ${winningTheme().glow}`,
                        }}
                    >
                        {value() !== undefined ? `${value()!.toFixed(1)}%` : "--"}
                    </div>
                </div>
                {lookahead() !== undefined && (
                    <span class="text-[10px] uppercase tracking-wide text-[#7c91b4]">
                        Delta lookahead {lookahead()! >= 0 ? "+" : ""}
                        {lookahead()!.toFixed(2)}
                    </span>
                )}
            </div>
        );
    };

    return (
        <div
            class="flex h-screen flex-col"
            style={{
                height: "calc(var(--vh, 1vh) * 100)",
            }}
        >
            <UpdateDialog />
            <Dialog open={showFAQ()} onOpenChange={setShowFAQ}>
                <FAQDialog />
            </Dialog>
            <Dialog open={showDownloadModal()} onOpenChange={setShowDownloadModal}>
                <DesktopAppDialog />
            </Dialog>
            <FilterDialog
                open={showFilters()}
                onOpenChange={setShowFilters}
            />
            <TeamSimulationDialog
                open={showTeamDialog()}
                onOpenChange={setShowTeamDialog}
            />

            <header class="relative z-10 border-b" style={headerStyle()}>
                <div class="flex flex-wrap items-center gap-4 px-4 py-3 xl:px-8">
                    <div class="flex min-w-[220px] items-center gap-4">
                        <h1
                            class="text-2xl font-semibold uppercase tracking-[0.4em]"
                            style={titleStyle()}
                        >
                            DRAFTGAP
                        </h1>
                        <div
                            class="rounded-full border px-3 py-1 text-[11px] uppercase tracking-wide"
                            style={patchBadgeStyle()}
                        >
                            Patch {patchLabel() ?? dataset()?.version ?? ""}
                        </div>
                        <span class="hidden text-[11px] text-[#9fb1cc] md:inline">
                            Data updated {timeAgo()}
                        </span>
                    </div>
                    <div class="flex min-w-[280px] flex-1 justify-center">
                        <WinrateProjectionBar
                            value={projectionPercent()}
                            delta={deltaPercent()}
                            lookahead={lookaheadScore()}
                        />
                    </div>
                    <div class="ml-auto flex items-center gap-2">
                        <button
                            type="button"
                            class={cn(
                                buttonVariants({ variant: "secondary" }),
                                "inline-flex items-center gap-2 text-sm uppercase"
                            )}
                            onClick={resetAll}
                        >
                            Nouvelle draft
                        </button>
                        <button
                            type="button"
                            class={cn(
                                buttonVariants({ variant: "transparent" }),
                                "inline-flex items-center gap-2 px-3 py-2 text-sm uppercase text-neutral-300 hover:text-neutral-100"
                            )}
                            onClick={() => setShowFilters(true)}
                        >
                            <Icon path={funnel} class="w-5" />
                            Filtres
                        </button>
                        <Show when={showTeamButton()}>
                            <button
                                type="button"
                                class={cn(
                                    buttonVariants({ variant: "transparent" }),
                                    "inline-flex items-center gap-2 px-3 py-2 text-sm uppercase text-neutral-300 hover:text-neutral-100"
                                )}
                                onClick={() => setShowTeamDialog(true)}
                            >
                                <Icon path={adjustmentsHorizontal} class="w-5" />
                                Equipes pro
                            </button>
                        </Show>
                        <Dialog
                            open={showSettings()}
                            onOpenChange={setShowSettings}
                        >
                            <DialogTrigger
                                class={cn(
                                    buttonVariants({ variant: "transparent" }),
                                    "px-1 py-2 text-neutral-300 hover:text-neutral-100"
                                )}
                            >
                                <Icon path={cog_6Tooth} class="w-6" />
                            </DialogTrigger>
                            <SettingsDialog />
                        </Dialog>
                    </div>
                </div>
                <div class="px-4 py-3 xl:px-8" style={toolbarStyle()}>
                    <div class="flex flex-col items-stretch gap-3 md:flex-row md:flex-wrap md:items-center md:justify-center">
                        <div class="w-full max-w-3xl md:flex-1">
                            <Search />
                        </div>
                        <div class="flex flex-wrap items-center justify-center gap-3 text-sm text-[#91A6C6]">
                            <RoleFilter class="min-w-[180px]" />
                            <Show when={config.enableBetaFeatures}>
                                <button
                                    type="button"
                                    class="text-xs uppercase tracking-wide text-[#5d6b84] transition hover:text-[#d7e9ff]"
                                    onClick={() => setShowFAQ(true)}
                                >
                                    FAQ
                                </button>
                            </Show>
                            <Show when={config.enableBetaFeatures}>
                                <button
                                    type="button"
                                    class="text-xs uppercase tracking-wide text-[#5d6b84] transition hover:text-[#d7e9ff]"
                                    onClick={() => setShowDownloadModal(true)}
                                >
                                    Desktop
                                </button>
                            </Show>
                        </div>
                    </div>
                </div>
            </header>

            <main class="flex-1 overflow-hidden" style={mainStyle()}>
                <Switch>
                    <Match
                        when={
                            dataset.state === "ready" && dataset() === undefined
                        }
                    >
                        <div class="flex h-full items-center justify-center text-2xl text-red-500">
                            An unexpected error occurred. Please try again
                            later.
                        </div>
                    </Match>
                    <Match when={!isLoaded()}>
                        <div class="flex h-full items-center justify-center text-2xl">
                            <LoadingIcon class="h-10 w-10 animate-spin" />
                        </div>
                    </Match>
                    <Match when={isLoaded()}>
                        <DraftView />
                    </Match>
                </Switch>
            </main>
        </div>
    );
};

export default App;




