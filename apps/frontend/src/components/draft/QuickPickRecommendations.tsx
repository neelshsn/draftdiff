import {
    Component,
    For,
    Show,
    createEffect,
    createMemo,
    createSignal,
} from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "solid-heroicons";
import {
    chevronLeft,
    chevronRight,
    lockClosed,
    questionMarkCircle,
    shieldCheck,
    eye,
    arrowsRightLeft,
    sparkles,
    bolt,
    exclamationTriangle,
    noSymbol,
} from "solid-heroicons/solid";
import { useDraft, DRAFT_SEQUENCE } from "../../contexts/DraftContext";
import { useDataset } from "../../contexts/DatasetContext";
import { useDraftFilters } from "../../contexts/DraftFiltersContext";
import { useUser } from "../../contexts/UserContext";
import { ROLES, Role, displayNameByRole } from "@draftgap/core/src/models/Role";
import { Team } from "@draftgap/core/src/models/Team";
import { cn } from "../../utils/style";
import { championName } from "../../utils/i18n";
import {
    DraftCandidateScore,
    DraftEngine,
    DraftPickDescriptor,
    evaluateDraft,
    scoreCandidate,
} from "@draftgap/core/src/draft/engine";
import type { DraftGapConfig } from "@draftgap/core/src/models/user/Config";
import type { Dataset } from "@draftgap/core/src/models/dataset/Dataset";
import { RoleIcon } from "../icons/roles/RoleIcon";
import { ChampionIcon } from "../icons/ChampionIcon";

const MAX_RESULTS_PER_ROLE = 6;
const MIN_PICKRATE_RESULTS = 4;
const ROLE_BRANCHING_FACTOR = 8;
const BEAM_WIDTH = 6;
const LOOKAHEAD_DEPTH = 2;
const MAX_COMBO_VARIANTS_PER_ROLE = 4;

const TEAM_LABEL: Record<Team, string> = {
    ally: "Allies",
    opponent: "Adversaires",
};

const normalizeSearchValue = (value: string) =>
    value.replaceAll(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "").toLowerCase();

const isMetaPick = (pickRate: number, threshold: number) => {
    if (threshold > 0) return pickRate >= threshold;
    return pickRate > 0;
};

type RecommendationStatus = "eligible" | "banned" | "picked";

export type RecommendationEntry = {
    championKey: string;
    role: Role;
    roleLabel: string;
    lookaheadDelta: number;
    immediateDelta: number;
    teamScore: number;
    projectedScore: number;
    pickRate: number;
    isMeta: boolean;
    breakdown: DraftCandidateScore["pick"];
    contributions: ScoreContribution[];
    status: RecommendationStatus;
    flexRoles: FlexOption[];
    synergyPartner?: SynergyHighlight;
    counterTarget?: CounterHighlight;
    denyScore: number;
    exposureScore: number;
    reasonTags: ReasonTag[];
};

type QuickPickRecommendationsProps = {
    onEntriesChange?: (entries: RecommendationEntry[]) => void;
};

type ScoreContribution = {
    label: string;
    weighted: number;
    base: number;
    weight: number;
    description: string;
    weightLabel?: string;
};

type PickRecommendation = {
    championKey: string;
    role: Role;
    lookaheadDelta: number;
    immediateDelta: number;
    teamScore: number;
    projectedScore: number;
    pickRate: number;
    isMeta: boolean;
    breakdown: DraftCandidateScore["pick"];
    contributions: ScoreContribution[];
    flexRoles: FlexOption[];
    synergyPartner?: SynergyHighlight;
    counterTarget?: CounterHighlight;
    denyScore: number;
    exposureScore: number;
    reasonTags: ReasonTag[];
};

type RoleRecommendation = {
    role: Role;
    roleLabel: string;
    picks: PickRecommendation[];
};

type CarouselSingleItem = {
    type: "single";
    pick: PickRecommendation;
    status: RecommendationStatus;
};

type CarouselComboItem = {
    type: "combo";
    picks: [PickRecommendation, PickRecommendation];
    combinedScore: number;
    combinedDelta: number;
    synergyDelta: number;
};

type CarouselItem = CarouselSingleItem | CarouselComboItem;

type FlexOption = {
    role: Role;
    share: number;
};

type SynergyHighlight = {
    championKey: string;
    score: number;
};

type CounterHighlight = {
    championKey: string;
    score: number;
};

type ReasonTag = {
    id: ReasonKey;
    label: string;
    value: number;
    weight: number;
    positive: boolean;
};

type ReasonKey =
    | "intrinsic"
    | "reliability"
    | "blind"
    | "flex"
    | "synergy"
    | "counter"
    | "deny"
    | "exposure";

const QuickPickRecommendations: Component<QuickPickRecommendationsProps> = (
    props
) => {
    const {
        allyTeam,
        opponentTeam,
        bans,
        selection,
        currentTurn,
        pickChampion,
        allyProTeam,
        opponentProTeam,
    } = useDraft();
    const {
        draftEngine: baseDraftEngine,
        dataset: currentDataset,
        getProTeamDataset,
        getScopedDraftEngine,
    } = useDataset();
    const { search, metaFilter, roleFilter } = useDraftFilters();
    const { config } = useUser();

    const normalizedSearch = createMemo(() => {
        const raw = search();
        if (!raw) return undefined;
        const normalized = normalizeSearchValue(raw);
        return normalized.length ? normalized : undefined;
    });

    const activeTeam = createMemo<Team>(() => {
        const selected = selection.team;
        if (selected === "ally" || selected === "opponent") {
            return selected;
        }
        const turn = currentTurn();
        if (turn?.team) return turn.team;
        return "ally";
    });

    const quickPickSource = createMemo<
        { engine: DraftEngine; dataset: Dataset | undefined } | undefined
    >(() => {
        const engine = baseDraftEngine();
        const baseDataset = currentDataset();
        if (!engine || !baseDataset) return undefined;

        let datasetForTeam: Dataset | undefined = baseDataset;
        let engineForTeam: DraftEngine | undefined = engine;

        if (config.dataSource === "pro") {
            const teamName =
                activeTeam() === "ally" ? allyProTeam() : opponentProTeam();
            if (teamName) {
                const scopedDataset = getProTeamDataset(teamName);
                if (scopedDataset) {
                    datasetForTeam = scopedDataset;
                    const scopedEngine = getScopedDraftEngine(scopedDataset);
                    if (scopedEngine) {
                        engineForTeam = scopedEngine;
                    }
                }
            }
        }

        return engineForTeam
            ? { engine: engineForTeam, dataset: datasetForTeam }
            : undefined;
    });

    const minPickRateThreshold = createMemo(
        () => Math.max(config.quickPickMinPickRate ?? 0, 0) / 100
    );

    const roleTotals = createMemo(() => {
        const dataset = quickPickSource()?.dataset;
        if (!dataset) return undefined;
        return computeRoleTotals(dataset);
    });

    const effectivePickRateThreshold = createMemo(() =>
        roleTotals() ? minPickRateThreshold() : 0
    );

    const openSlots = createMemo(() =>
        DRAFT_SEQUENCE.filter(({ team, index }) => {
            const pick =
                team === "ally" ? allyTeam[index] : opponentTeam[index];
            return !pick?.championKey;
        })
    );

    const doublePickPhase = createMemo(() => {
        const slots = openSlots();
        if (slots.length < 2) return false;
        return slots[0].team === slots[1].team;
    });

    const recommendationContext = createMemo(() => {
        const source = quickPickSource();
        if (!source) return undefined;
        const { engine, dataset: activeDataset } = source;

        const team = activeTeam();
        const teamDraft = team === "ally" ? allyTeam : opponentTeam;
        const enemyDraft = team === "ally" ? opponentTeam : allyTeam;

        const teamMap = toRoleMap(teamDraft);
        const enemyMap = toRoleMap(enemyDraft);

        const openRoles = ROLES.filter((role) => !teamMap.has(role));
        if (!openRoles.length) return undefined;

        const baselineEval = evaluateDraft(engine, teamMap, enemyMap);
        const baselineScore = baselineEval?.totalScore ?? 0;

        const usedBase = buildUsedSet(teamMap, enemyMap, bans);
        const searchTerm = normalizedSearch();

        const selectedIndex =
            selection.team === team ? selection.index : undefined;
        const selectedRole =
            selectedIndex !== undefined
                ? teamDraft[selectedIndex]?.role
                : undefined;

        const filterRole = roleFilter();
        const filteredOpenRoles =
            filterRole !== undefined
                ? openRoles.filter((role) => role === filterRole)
                : openRoles;
        const rolesCandidate =
            filteredOpenRoles.length > 0 ? filteredOpenRoles : openRoles;

        const rolesToExplore =
            selectedRole !== undefined && rolesCandidate.includes(selectedRole)
                ? [selectedRole]
                : rolesCandidate;

        const rawRoles = rolesToExplore
            .map((role) => {
                const targetRole = rolesCandidate.includes(role)
                    ? role
                    : rolesCandidate[0];
                if (targetRole === undefined) return undefined;
                const picks = computeRoleRecommendations({
                    engine,
                    role: targetRole,
                    teamMap,
                    enemyMap,
                    baselineScore,
                    openRoles,
                    used: usedBase,
                    bans,
                    searchTerm,
                    dataset: activeDataset,
                    roleTotals: roleTotals(),
                    minPickRate: effectivePickRateThreshold(),
                    config,
                });
                return {
                    role: targetRole,
                    roleLabel: displayNameByRole[targetRole],
                    picks,
                };
            })
            .filter(Boolean)
            .map((entry) => entry!)
            .filter((entry) => entry.picks.length > 0);

        const roleFiltered =
            filterRole !== undefined
                ? rawRoles.filter((entry) => entry.role === filterRole)
                : rawRoles;

        const rolesSource =
            roleFiltered.length > 0 || filterRole === undefined
                ? roleFiltered
                : rawRoles;

        const metaSetting = metaFilter();
        const filteredRoles = rolesSource
            .map((entry) => {
                const picks = entry.picks.filter((pick) => {
                    if (metaSetting === "meta") {
                        if (pick.isMeta) return true;
                        if (searchTerm && activeDataset) {
                            return matchesSearchTerm(
                                pick.championKey,
                                searchTerm,
                                activeDataset,
                                config
                            );
                        }
                        return false;
                    }
                    if (metaSetting === "offMeta") {
                        if (!pick.isMeta) return true;
                        if (searchTerm && activeDataset) {
                            return matchesSearchTerm(
                                pick.championKey,
                                searchTerm,
                                activeDataset,
                                config
                            );
                        }
                        return false;
                    }
                    return true;
                });
                return { ...entry, picks };
            })
            .filter((entry) => entry.picks.length > 0);

        if (!filteredRoles.length) return undefined;

        const bannedSet = new Set(bans);
        const allyUsed = new Set(teamMap.values());
        const enemyUsed = new Set(enemyMap.values());

        return {
            team,
            baselineScore,
            teamMap,
            enemyMap,
            openRoles,
            roles: filteredRoles,
            dataset: activeDataset,
            engine,
            bannedSet,
            allyUsed,
            enemyUsed,
        };
    });

    const datasetForDisplay = createMemo(
        () => quickPickSource()?.dataset ?? currentDataset()
    );

    const championLabel = (championKey: string) => {
        const dataset = datasetForDisplay();
        const champion = dataset?.championData[championKey];
        return champion ? championName(champion, config) : championKey;
    };

    const championSplash = (championKey: string) => {
        const dataset = datasetForDisplay();
        const id =
            dataset?.championData[championKey]?.id ?? championKey;
        const normalized = id === "Fiddlesticks" ? "FiddleSticks" : id;
        return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${normalized}_0.jpg`;
    };

    const manualEntries = createMemo<RecommendationEntry[]>(() => {
        const ctx = recommendationContext();
        if (!ctx) return [];
        const statusForChampion = (championKey: string) =>
            getRecommendationStatus(
                championKey,
                ctx.bannedSet,
                ctx.allyUsed,
                ctx.enemyUsed
            );

        const entries = ctx.roles.flatMap((roleRec) =>
            roleRec.picks.map((pick) => ({
                championKey: pick.championKey,
                role: pick.role,
                roleLabel: displayNameByRole[pick.role],
                lookaheadDelta: pick.lookaheadDelta,
                immediateDelta: pick.immediateDelta,
                teamScore: pick.teamScore,
                projectedScore: pick.projectedScore,
                pickRate: pick.pickRate,
                isMeta: pick.isMeta,
                breakdown: pick.breakdown,
                contributions: pick.contributions,
                status: statusForChampion(pick.championKey),
                flexRoles: pick.flexRoles,
                synergyPartner: pick.synergyPartner,
                counterTarget: pick.counterTarget,
                denyScore: pick.denyScore,
                exposureScore: pick.exposureScore,
                reasonTags: pick.reasonTags,
            }))
        );
        entries.sort((a, b) => b.lookaheadDelta - a.lookaheadDelta);
        return entries;
    });

    createEffect(() => {
        const entries = manualEntries();
        props.onEntriesChange?.(entries);
    });

    const singleItems = createMemo<CarouselSingleItem[]>(() => {
        const ctx = recommendationContext();
        if (!ctx) return [];
        const statusForChampion = (championKey: string) =>
            getRecommendationStatus(
                championKey,
                ctx.bannedSet,
                ctx.allyUsed,
                ctx.enemyUsed
            );
        const items = ctx.roles.flatMap((roleRec) =>
            roleRec.picks.map((pick) => ({
                type: "single" as const,
                pick,
                status: statusForChampion(pick.championKey),
            }))
        );
        items.sort((a, b) => b.pick.lookaheadDelta - a.pick.lookaheadDelta);
        return items;
    });

    const comboItems = createMemo<CarouselComboItem[]>(() => {
        const ctx = recommendationContext();
        if (!ctx) return [];
        const combos = computeComboItems({
            engine: ctx.engine,
            baselineScore: ctx.baselineScore,
            teamMap: ctx.teamMap,
            enemyMap: ctx.enemyMap,
            roleRecommendations: ctx.roles,
        });
        const filterRoleValue = roleFilter();
        return filterRoleValue !== undefined
            ? combos.filter((combo) =>
                  combo.picks.some((pick) => pick.role === filterRoleValue)
              )
            : combos;
    });

    const baseItems = createMemo<CarouselItem[]>(() => {
        const combos = comboItems();
        if (doublePickPhase() && combos.length) {
            return combos;
        }
        return singleItems();
    });

    const baseCount = createMemo(() => baseItems().length);

    const teamLabel = createMemo(
        () => TEAM_LABEL[recommendationContext()?.team ?? activeTeam()]
    );

    const canPick = createMemo(() => {
        const ctx = recommendationContext();
        const turn = currentTurn();
        if (!ctx || !turn) return false;
        return turn.team === ctx.team;
    });

    const pickDisabledReason = createMemo(() => {
        const turn = currentTurn();
        if (!turn) return "Draft terminee";
        const ctx = recommendationContext();
        if (!ctx) return undefined;
        if (turn.team !== ctx.team) {
            return `Tour actuel : ${TEAM_LABEL[turn.team]}`;
        }
        return undefined;
    });

    const [virtualIndex, setVirtualIndex] = createSignal(0);
    const [transitionEnabled, setTransitionEnabled] = createSignal(true);

    createEffect(() => {
        const count = baseCount();
        if (!count) return;
        setTransitionEnabled(false);
        setVirtualIndex(count);
        requestAnimationFrame(() => setTransitionEnabled(true));
    });

    const extendedItems = createMemo(() => {
        const base = baseItems();
        return base.length ? [...base, ...base, ...base] : [];
    });

    const activeItem = createMemo<CarouselItem | undefined>(() => {
        const base = baseItems();
        const count = base.length;
        if (!count) return undefined;
        const idx = modulo(virtualIndex() - count, count);
        return base[idx];
    });

    const trackStyle = createMemo(() => ({
        transform: `translateX(-${virtualIndex() * 100}%)`,
        transition: transitionEnabled()
            ? "transform 520ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "none",
    }));

    const handleTransitionEnd = () => {
        const count = baseCount();
        if (!count) return;
        const idx = virtualIndex();
        const min = count;
        const max = count * 2 - 1;
        if (idx < min || idx > max) {
            const normalized = count + modulo(idx - count, count);
            setTransitionEnabled(false);
            setVirtualIndex(normalized);
            requestAnimationFrame(() => setTransitionEnabled(true));
        }
    };

    const goPrev = () => {
        if (!baseCount()) return;
        setVirtualIndex((value) => value - 1);
    };

    const goNext = () => {
        if (!baseCount()) return;
        setVirtualIndex((value) => value + 1);
    };

    const [modalItem, setModalItem] = createSignal<CarouselItem | undefined>();
    const [modalOpen, setModalOpen] = createSignal(false);

    const openModal = (item: CarouselItem) => {
        setModalItem(item);
        setModalOpen(true);
    };

    const closeModal = () => setModalOpen(false);

    createEffect(() => {
        if (!baseCount()) {
            setModalOpen(false);
            setModalItem(undefined);
        }
    });

    const handleLockIn = (item: CarouselItem | undefined) => {
        if (!item || !canPick()) return;
        const ctx = recommendationContext();
        if (!ctx) return;
        const turn = currentTurn();
        if (!turn || turn.team !== ctx.team) return;

        if (item.type === "single") {
            const pick = item.pick;
            pickChampion(
                turn.team,
                turn.index,
                pick.championKey,
                pick.breakdown.role
            );
            return;
        }

        const [first, second] = item.picks;
        pickChampion(
            turn.team,
            turn.index,
            first.championKey,
            first.breakdown.role
        );
        const nextTurn = currentTurn();
        if (!nextTurn || nextTurn.team !== ctx.team) return;
        pickChampion(
            nextTurn.team,
            nextTurn.index,
            second.championKey,
            second.breakdown.role
        );
    };

    return (
        <div class="flex h-full flex-col gap-6 p-5">
            <div class="flex items-start justify-between gap-4">
                <div class="space-y-1">
                    <h2 class="text-base font-semibold uppercase tracking-[0.34em] text-neutral-200">
                        Quick Picks
                    </h2>
                    <div class="text-xs uppercase tracking-[0.24em] text-neutral-500">
                        Meta recommandations pour {teamLabel()}
                    </div>
                </div>
                <Show when={recommendationContext()}>
                    {(ctx) => (
                        <div class="text-right text-sm text-neutral-400">
                            Score actuel{" "}
                            <span class={scoreTextClass(ctx().baselineScore)}>
                                {formatScore(ctx().baselineScore)}
                            </span>
                        </div>
                    )}
                </Show>
            </div>

            <Show
                when={baseItems().length}
                fallback={<EmptyRecommendations teamLabel={teamLabel()} />}
            >
                <div class="relative flex-1 overflow-hidden rounded-2xl border border-neutral-800/70 bg-neutral-950/40">
                    <Show when={activeItem()} keyed>
                        {(item) => (
                            <div class="absolute inset-0">
                                <CarouselBackground
                                    item={item}
                                    championSplash={championSplash}
                                />
                                <div class="absolute inset-0 bg-gradient-to-br from-black/55 via-black/65 to-black/80" />
                            </div>
                        )}
                    </Show>

                    <div class="relative h-full">
                        <div
                            class="flex h-full"
                            style={trackStyle()}
                            onTransitionEnd={handleTransitionEnd}
                        >
                            <For each={extendedItems()}>
                                {(item) => (
                                    <div class="flex w-full flex-shrink-0 flex-col justify-between px-10 py-10">
                                        <CarouselContent
                                            item={item}
                                            canPick={canPick()}
                                            disabledReason={pickDisabledReason()}
                                            onLock={() => handleLockIn(item)}
                                            onInfo={() => openModal(item)}
                                            championLabel={championLabel}
                                        />
                                    </div>
                                )}
                            </For>
                        </div>

                        <CarouselArrow
                            direction="left"
                            disabled={baseCount() <= 1}
                            onClick={goPrev}
                        />
                        <CarouselArrow
                            direction="right"
                            disabled={baseCount() <= 1}
                            onClick={goNext}
                        />
                    </div>
                </div>
            </Show>

            <Show when={modalOpen() && modalItem()}>
                {(value) => (
                    <InfoModal
                        item={value()}
                        onClose={closeModal}
                        championLabel={championLabel}
                    />
                )}
            </Show>
        </div>
    );
};

const CarouselContent: Component<{
    item: CarouselItem;
    canPick: boolean;
    disabledReason?: string;
    onLock: () => void;
    onInfo: () => void;
    championLabel: (championKey: string) => string;
}> = (props) => {
    if (props.item.type === "single") {
        return (
            <SingleCarouselView
                item={props.item}
                canPick={props.canPick}
                disabledReason={props.disabledReason}
                onLock={props.onLock}
                onInfo={props.onInfo}
                championLabel={props.championLabel}
            />
        );
    }
    return (
        <ComboCarouselView
            item={props.item as CarouselComboItem}
            canPick={props.canPick}
            disabledReason={props.disabledReason}
            onLock={props.onLock}
            onInfo={props.onInfo}
            championLabel={props.championLabel}
        />
    );
};

const SingleCarouselView: Component<{
    item: CarouselSingleItem;
    canPick: boolean;
    disabledReason?: string;
    onLock: () => void;
    onInfo: () => void;
    championLabel: (championKey: string) => string;
}> = (props) => {
    const pick = () => props.item.pick;
    const reasons = createMemo(() => buildDisplayReasonTags(pick().reasonTags));
    const flexRoles = createMemo(() => pick().flexRoles);
    const synergy = () => pick().synergyPartner;
    const counter = () => pick().counterTarget;

    return (
        <div class="relative flex h-full flex-col justify-between px-10 py-12 text-neutral-100">
            <div class="flex flex-col items-center gap-5 text-center">
                <div class="flex flex-wrap items-center justify-center gap-3 text-xs uppercase tracking-[0.32em] text-neutral-200 drop-shadow-[0_0_8px_rgba(7,14,25,0.6)]">
                    <span class="inline-flex items-center gap-2 rounded-full border border-neutral-700/70 bg-black/30 px-3 py-1">
                        <RoleIcon
                            role={pick().role}
                            class="h-5 w-5"
                            style={{
                                color: "rgba(167, 214, 255, 0.95)",
                                filter: "drop-shadow(0 0 12px rgba(94,190,255,0.6))",
                            }}
                        />
                        {displayNameByRole[pick().role]}
                    </span>
                    <span
                        class={cn(
                            "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em]",
                            pick().isMeta
                                ? "border border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
                                : "border border-amber-400/60 bg-amber-500/15 text-amber-200"
                        )}
                    >
                        {pick().isMeta ? "Meta" : "Off meta"}
                    </span>
                    <Show when={flexRoles().length}>
                        <FlexRolesDisplay roles={flexRoles()} />
                    </Show>
                </div>
                <div class="font-champion text-5xl font-semibold text-white drop-shadow-[0_0_28px_rgba(255,255,255,0.18)]">
                    {props.championLabel(pick().championKey)}
                </div>
                <div class="flex flex-wrap justify-center gap-3 text-[11px] uppercase tracking-[0.28em] text-neutral-100 drop-shadow-[0_0_10px_rgba(9,16,28,0.6)]">
                    <MetricPill label="Score equipe" value={pick().teamScore} />
                    <MetricPill label="Immediat" value={pick().immediateDelta} />
                    <MetricPill label="Pickrate" value={pick().pickRate} valueType="percentage" />
                </div>
            </div>
            <div class="mt-6 flex flex-wrap justify-center gap-2 drop-shadow-[0_0_8px_rgba(8,14,25,0.55)]">
                <For each={reasons()}>
                    {(tag) => <ReasonBadge tag={tag} />}
                </For>
            </div>
            <div class="mt-6 flex flex-wrap justify-center gap-2 text-xs uppercase tracking-[0.28em] text-neutral-100 drop-shadow-[0_0_8px_rgba(8,14,25,0.55)]">
                <Show when={synergy()}>
                    {(value) => (
                        <HighlightChip
                            icon={sparkles}
                            label="Synergie"
                            value={formatScore(value().score)}
                            champions={[value().championKey]}
                        />
                    )}
                </Show>
                <Show when={counter()}>
                    {(value) => (
                        <HighlightChip
                            icon={bolt}
                            label="Counter"
                            value={formatScore(value().score)}
                            champions={[value().championKey]}
                        />
                    )}
                </Show>
                <Show when={pick().denyScore > 0.05}>
                    <HighlightChip
                        icon={noSymbol}
                        label="Deny"
                        value={formatScore(pick().denyScore)}
                        tone="positive"
                    />
                </Show>
                <Show when={pick().exposureScore > 0.05}>
                    <HighlightChip
                        icon={exclamationTriangle}
                        label="Exposition"
                        value={formatScore(-pick().exposureScore)}
                        tone="warning"
                    />
                </Show>
            </div>
            <div class="mt-8 flex flex-wrap items-center justify-between gap-4">
                <div class="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.28em] text-neutral-100 drop-shadow-[0_0_8px_rgba(8,14,25,0.55)]">
                    <MetricPill label="Projection" value={pick().lookaheadDelta} />
                    <MetricPill label="Projection brute" value={pick().projectedScore} />
                </div>
                <div class="flex flex-wrap items-center gap-3">
                    <Show when={!props.canPick && props.disabledReason}>
                        {(reason) => (
                            <div class="rounded-full border border-neutral-700/70 bg-black/40 px-4 py-1 text-[11px] uppercase tracking-[0.28em] text-neutral-300 drop-shadow-[0_0_10px_rgba(8,14,25,0.5)]">
                                {reason()}
                            </div>
                        )}
                    </Show>
                    <LockControls
                        canPick={props.canPick}
                        onLock={props.onLock}
                        onInfo={props.onInfo}
                    />
                </div>
            </div>
        </div>
    );
};

const ComboCarouselView: Component<{
    item: CarouselComboItem;
    canPick: boolean;
    disabledReason?: string;
    onLock: () => void;
    onInfo: () => void;
    championLabel: (championKey: string) => string;
}> = (props) => {
    const [first, second] = props.item.picks;
    const reasonsFirst = createMemo(() =>
        buildDisplayReasonTags(first.reasonTags).slice(0, 3)
    );
    const reasonsSecond = createMemo(() =>
        buildDisplayReasonTags(second.reasonTags).slice(0, 3)
    );

    const immediateTotal =
        props.item.picks[0].immediateDelta + props.item.picks[1].immediateDelta;

    return (
        <div class="relative flex h-full flex-col justify-between px-10 py-12 text-neutral-100">
            <div class="grid flex-1 items-center gap-8 lg:grid-cols-2">
                <ComboPickSummary
                    pick={first}
                    championLabel={props.championLabel}
                    reasons={reasonsFirst()}
                />
                <ComboPickSummary
                    pick={second}
                    championLabel={props.championLabel}
                    reasons={reasonsSecond()}
                />
            </div>
            <div class="mt-6 flex flex-wrap justify-center gap-3 text-xs uppercase tracking-[0.28em] text-neutral-100 drop-shadow-[0_0_8px_rgba(8,14,25,0.55)]">
                <HighlightChip
                    icon={sparkles}
                    label="Synergie duo"
                    value={formatScore(props.item.synergyDelta)}
                    champions={[first.championKey, second.championKey]}
                />
                <HighlightChip
                    icon={bolt}
                    label="Gains immediats"
                    value={formatScore(immediateTotal)}
                    tone="positive"
                />
            </div>
            <div class="mt-8 flex flex-wrap items-center justify-between gap-4">
                <div class="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.28em] text-neutral-100 drop-shadow-[0_0_8px_rgba(8,14,25,0.55)]">
                    <MetricPill label="Projection duo" value={props.item.combinedDelta} />
                    <MetricPill label="Score equipe" value={props.item.combinedScore} />
                </div>
                <div class="flex flex-wrap items-center gap-3">
                    <Show when={!props.canPick && props.disabledReason}>
                        {(reason) => (
                            <div class="rounded-full border border-neutral-700/70 bg-black/40 px-4 py-1 text-[11px] uppercase tracking-[0.28em] text-neutral-300 drop-shadow-[0_0_10px_rgba(8,14,25,0.5)]">
                                {reason()}
                            </div>
                        )}
                    </Show>
                    <LockControls
                        canPick={props.canPick}
                        onLock={props.onLock}
                        onInfo={props.onInfo}
                    />
                </div>
            </div>
        </div>
    );
};

const ComboPickSummary: Component<{
    pick: PickRecommendation;
    championLabel: (championKey: string) => string;
    reasons: ReasonTag[];
}> = (props) => (
    <div class="flex flex-col items-center gap-3 text-center drop-shadow-[0_0_16px_rgba(6,12,22,0.65)]">
        <div class="flex flex-wrap items-center justify-center gap-2 text-[10px] uppercase tracking-[0.26em] text-neutral-200">
            <span class="inline-flex items-center gap-2 rounded-full border border-neutral-700/60 bg-black/25 px-3 py-[5px]">
                <RoleIcon
                    role={props.pick.role}
                    class="h-4 w-4"
                    style={{
                        color: "rgba(167, 214, 255, 0.95)",
                        filter: "drop-shadow(0 0 10px rgba(94,190,255,0.55))",
                    }}
                />
                {displayNameByRole[props.pick.role]}
            </span>
            <Show when={props.pick.flexRoles.length}>
                <FlexRolesDisplay roles={props.pick.flexRoles} />
            </Show>
        </div>
        <div class="font-champion text-3xl text-white drop-shadow-[0_0_22px_rgba(255,255,255,0.2)]">
            {props.championLabel(props.pick.championKey)}
        </div>
        <div class="flex flex-wrap justify-center gap-2 text-[11px] uppercase tracking-[0.22em] text-neutral-200">
            <MetricPill label="Projection" value={props.pick.lookaheadDelta} compact />
            <MetricPill label="Pickrate" value={props.pick.pickRate} valueType="percentage" compact />
        </div>
        <div class="mt-2 flex flex-wrap justify-center gap-2">
            <For each={props.reasons}>
                {(tag) => <ReasonBadge tag={tag} />}
            </For>
        </div>
    </div>
);

const LockControls: Component<{
    canPick: boolean;
    onLock: () => void;
    onInfo: () => void;
}> = (props) => (
    <div class="flex items-center gap-2">
        <button
            type="button"
            disabled={!props.canPick}
            class={cn(
                "group relative inline-flex h-10 items-center gap-2 overflow-hidden rounded-full border px-4 text-xs font-semibold uppercase tracking-[0.28em] transition duration-300",
                props.canPick
                    ? "border-amber-300/70 bg-amber-500/20 text-amber-100 hover:text-neutral-900"
                    : "cursor-not-allowed border-neutral-700/70 bg-neutral-900/60 text-neutral-500"
            )}
            onClick={() => props.canPick && props.onLock()}
        >
            <span class="pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100">
                <span class="absolute inset-0 bg-gradient-to-r from-amber-500/80 via-yellow-400/70 to-amber-300/80 blur-md opacity-80" />
            </span>
            <span class="relative inline-flex items-center gap-2">
                <Icon
                    path={lockClosed}
                    class={cn(
                        "h-4 w-4 transition duration-300",
                        props.canPick
                            ? "group-hover:-translate-y-0.5 group-hover:rotate-6 group-hover:text-neutral-900"
                            : ""
                    )}
                />
                <span>LOCK IN</span>
            </span>
        </button>
        <button
            type="button"
            class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-700/80 bg-neutral-900/70 text-neutral-200 transition hover:text-amber-200"
            onClick={props.onInfo}
        >
            <Icon path={questionMarkCircle} class="h-5 w-5" />
        </button>
    </div>
);

const ProjectionMetric: Component<{
    label: string;
    value: number;
    valueType?: "score" | "percentage";
}> = (props) => (
    <div class="flex items-center justify-between text-[12px] uppercase tracking-[0.24em] text-neutral-300">
        <span>{props.label}</span>
        <span
            class={
                props.valueType === "percentage"
                    ? "text-neutral-100"
                    : scoreTextClass(props.value)
            }
        >
            {props.valueType === "percentage"
                ? formatPercentage(props.value)
                : formatScore(props.value)}
        </span>
    </div>
);

const MetricPill: Component<{
    label: string;
    value: number;
    valueType?: "score" | "percentage";
    compact?: boolean;
}> = (props) => (
    <span
        class={cn(
            "inline-flex items-center gap-2 rounded-full border border-neutral-700/70 bg-black/35 px-3 py-1",
            props.compact && "text-[10px] tracking-[0.24em]"
        )}
    >
        <span>{props.label}</span>
        <span
            class={
                props.valueType === "percentage"
                    ? "text-neutral-100"
                    : scoreTextClass(props.value)
            }
        >
            {props.valueType === "percentage"
                ? formatPercentage(props.value)
                : formatScore(props.value)}
        </span>
    </span>
);

const HighlightChip: Component<{
    icon: typeof sparkles;
    label: string;
    value: string;
    champions?: string[];
    tone?: "positive" | "warning" | "neutral";
}> = (props) => {
    const tone = props.tone ?? "neutral";
    const palette =
        tone === "positive"
            ? {
                  border: "border-emerald-400/40",
                  background: "bg-emerald-500/15",
                  text: "text-emerald-100",
              }
            : tone === "warning"
            ? {
                  border: "border-amber-400/40",
                  background: "bg-amber-500/15",
                  text: "text-amber-100",
              }
            : {
                  border: "border-neutral-600/60",
                  background: "bg-black/35",
                  text: "text-neutral-200",
              };

    return (
        <span
            class={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.24em]",
                palette.border,
                palette.background,
                palette.text
            )}
        >
            <Icon path={props.icon} class="h-4 w-4" />
            <span>{props.label}</span>
            <span>{props.value}</span>
            <Show when={props.champions}>
                {(champions) => (
                    <span class="flex items-center gap-1">
                        <For each={champions()}>
                            {(championKey) => (
                                <ChampionIcon
                                    championKey={championKey}
                                    size={22}
                                    class="overflow-hidden rounded-md border border-white/20"
                                />
                            )}
                        </For>
                    </span>
                )}
            </Show>
        </span>
    );
};

const ReasonBadge: Component<{ tag: ReasonTag }> = (props) => {
    const palette = metricPalette(props.tag.value);
    const icon = REASON_ICONS[props.tag.id] ?? sparkles;
    return (
        <div
            class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em]"
            style={{
                borderColor: palette.border,
                background: palette.background,
                color: palette.text,
            }}
            title={props.tag.label}
        >
            <Icon path={icon} class="h-4 w-4" />
            <span>{props.tag.label}</span>
            <span>{formatScore(props.tag.value)}</span>
        </div>
    );
};

const FlexRolesDisplay: Component<{ roles: FlexOption[] }> = (props) => (
    <div class="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-neutral-200 drop-shadow-[0_0_8px_rgba(7,14,25,0.55)]">
        <For each={props.roles.slice(0, 2)}>
            {(entry) => (
                <span class="inline-flex items-center gap-1 rounded-full border border-neutral-600/60 px-2 py-[4px] text-[10px]">
                    <RoleIcon role={entry.role} class="h-4 w-4" />
                    {displayNameByRole[entry.role]} {Math.round(entry.share * 100)}%
                </span>
            )}
        </For>
    </div>
);

const REASON_PRIORITY: ReasonKey[] = [
    "reliability",
    "blind",
    "flex",
    "synergy",
    "counter",
    "deny",
    "exposure",
];

const REASON_ICONS: Partial<Record<ReasonKey, typeof sparkles>> = {
    intrinsic: sparkles,
    reliability: shieldCheck,
    blind: eye,
    flex: arrowsRightLeft,
    synergy: sparkles,
    counter: bolt,
    deny: noSymbol,
    exposure: exclamationTriangle,
};

function buildDisplayReasonTags(tags: ReasonTag[]): ReasonTag[] {
    const map = new Map<ReasonKey, ReasonTag>();
    for (const tag of tags) {
        if (!map.has(tag.id)) {
            map.set(tag.id, tag);
        } else if (Math.abs(tag.value) > Math.abs(map.get(tag.id)!.value)) {
            map.set(tag.id, tag);
        }
    }

    const ordered: ReasonTag[] = [];
    for (const key of REASON_PRIORITY) {
        const tag = map.get(key);
        if (tag && Math.abs(tag.value) >= 0.05) {
            ordered.push(tag);
            map.delete(key);
        }
    }

    const remaining = Array.from(map.values()).sort(
        (a, b) => Math.abs(b.value) - Math.abs(a.value)
    );

    return [...ordered, ...remaining].slice(0, 6);
}

function metricPalette(value: number) {
    const clamped = Math.max(-2, Math.min(2, value));
    const ratio = (clamped + 2) / 4; // 0 -> red, 1 -> green
    const hue = Math.round(120 * ratio);
    const light = value >= 0 ? 58 : 52;
    return {
        text: `hsl(${hue}, 85%, ${light}%)`,
        border: `hsla(${hue}, 85%, 55%, 0.55)`,
        background: `hsla(${hue}, 85%, 45%, 0.18)`,
    };
}

const CarouselArrow: Component<{
    direction: "left" | "right";
    disabled: boolean;
    onClick: () => void;
}> = (props) => (
    <button
        type="button"
        class={cn(
            "absolute top-1/2 -translate-y-1/2 rounded-full border border-neutral-700/70 bg-neutral-900/70 p-3 text-neutral-200 transition hover:text-amber-200",
            props.disabled && "cursor-not-allowed opacity-50 hover:text-neutral-200",
            props.direction === "left" ? "left-6" : "right-6"
        )}
        disabled={props.disabled}
        onClick={() => !props.disabled && props.onClick()}
    >
        <Icon
            path={props.direction === "left" ? chevronLeft : chevronRight}
            class="h-5 w-5"
        />
    </button>
);

const CarouselBackground: Component<{
    item: CarouselItem;
    championSplash: (championKey: string) => string;
}> = (props) => {
    if (props.item.type === "single") {
        const splash = props.championSplash(props.item.pick.championKey);
        return (
            <div class="absolute inset-0 overflow-hidden">
                <div
                    class="absolute inset-0 bg-cover"
                    style={{
                        "background-image": `url(${splash})`,
                        "background-position": "center top",
                        "background-size": "120%",
                    }}
                />
                <div class="absolute inset-0 bg-gradient-to-b from-black/25 via-black/45 to-black/80" />
            </div>
        );
    }

    const left = props.championSplash(props.item.picks[0].championKey);
    const right = props.championSplash(props.item.picks[1].championKey);

    return (
        <div class="absolute inset-0 overflow-hidden">
            <div
                class="absolute inset-0 bg-cover"
                style={{
                    "background-image": `url(${left})`,
                    "background-position": "center top",
                    "background-size": "120%",
                    transform: "scaleX(-1)",
                    "transform-origin": "center",
                    "clip-path": "polygon(0% 0%, 60% 0%, 40% 100%, 0% 100%)",
                }}
            />
            <div
                class="absolute inset-0 bg-cover"
                style={{
                    "background-image": `url(${right})`,
                    "background-position": "center top",
                    "background-size": "120%",
                    "clip-path": "polygon(40% 0%, 100% 0%, 100% 100%, 60% 100%)",
                }}
            />
            <div class="absolute inset-0 bg-gradient-to-br from-black/38 via-black/55 to-black/85" />
        </div>
    );
};

const InfoModal: Component<{
    item: CarouselItem;
    onClose: () => void;
    championLabel: (championKey: string) => string;
}> = (props) => (
    <Portal>
        <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div class="w-full max-w-3xl overflow-hidden rounded-2xl border border-neutral-700/70 bg-neutral-950/95 shadow-xl">
                <div class="flex items-center justify-between border-b border-neutral-800/80 px-6 py-4">
                    <div class="text-sm font-semibold uppercase tracking-[0.32em] text-neutral-300">
                        Analyse du pick
                    </div>
                    <button
                        type="button"
                        class="text-sm uppercase tracking-[0.24em] text-neutral-500 transition hover:text-amber-200"
                        onClick={props.onClose}
                    >
                        Fermer
                    </button>
                </div>
                <div class="max-h-[70vh] overflow-y-auto px-6 py-6">
                    <Show
                        when={props.item.type === "single"}
                        fallback={
                            <ComboModalContent
                                item={props.item as CarouselComboItem}
                                championLabel={props.championLabel}
                            />
                        }
                    >
                        <SingleModalContent
                            item={props.item as CarouselSingleItem}
                            championLabel={props.championLabel}
                        />
                    </Show>
                </div>
            </div>
        </div>
    </Portal>
);

const SingleModalContent: Component<{
    item: CarouselSingleItem;
    championLabel: (championKey: string) => string;
}> = (props) => {
    const pick = props.item.pick;
    return (
        <div class="space-y-6">
            <div class="flex flex-col gap-2">
                <div class="text-xs uppercase tracking-[0.24em] text-neutral-500">
                    {displayNameByRole[pick.role]}
                </div>
                <div class="flex items-center justify-between">
                    <div class="font-champion text-3xl text-neutral-50">
                        {props.championLabel(pick.championKey)}
                    </div>
                    <div class="text-right text-sm text-neutral-300">
                        Delta {formatScore(pick.lookaheadDelta)}
                    </div>
                </div>
                <div class="text-xs uppercase tracking-[0.24em] text-neutral-400">
                    Score {formatScore(pick.teamScore)} &bull; Immediate{" "}
                    {formatScore(pick.immediateDelta)} &bull; Projection{" "}
                    {formatScore(pick.projectedScore)} &bull; Pickrate{" "}
                    {formatPercentage(pick.pickRate)}
                </div>
            </div>
            <div class="rounded-xl border border-neutral-800/70 bg-neutral-900/60 p-4">
                <ContributionList
                    contributions={pick.contributions}
                    total={pick.breakdown.total}
                />
            </div>
        </div>
    );
};

const ComboModalContent: Component<{
    item: CarouselComboItem;
    championLabel: (championKey: string) => string;
}> = (props) => {
    const [first, second] = props.item.picks;
    return (
        <div class="space-y-6">
            <div class="space-y-2">
                <div class="text-xs uppercase tracking-[0.24em] text-neutral-500">
                    Phase double pick
                </div>
                <div class="flex items-center justify-between">
                    <div class="font-champion text-3xl text-neutral-50">
                        {props.championLabel(first.championKey)} +{" "}
                        {props.championLabel(second.championKey)}
                    </div>
                    <div class="text-right text-sm text-neutral-300">
                        Gain {formatScore(props.item.combinedDelta)}
                    </div>
                </div>
                <div class="text-xs uppercase tracking-[0.24em] text-neutral-400">
                    Synergie {formatScore(props.item.synergyDelta)}
                </div>
            </div>
            <div class="grid gap-4 md:grid-cols-2">
                <div class="space-y-3 rounded-xl border border-neutral-800/70 bg-neutral-900/60 p-4">
                    <div class="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                        {displayNameByRole[first.role]}
                    </div>
                    <div class="font-champion text-xl text-neutral-100">
                        {props.championLabel(first.championKey)}
                    </div>
                    <div class="text-xs uppercase tracking-[0.22em] text-neutral-400">
                        Delta {formatScore(first.lookaheadDelta)} &bull; Pickrate{" "}
                        {formatPercentage(first.pickRate)}
                    </div>
                    <ContributionList
                        contributions={first.contributions}
                        total={first.breakdown.total}
                    />
                </div>
                <div class="space-y-3 rounded-xl border border-neutral-800/70 bg-neutral-900/60 p-4">
                    <div class="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                        {displayNameByRole[second.role]}
                    </div>
                    <div class="font-champion text-xl text-neutral-100">
                        {props.championLabel(second.championKey)}
                    </div>
                    <div class="text-xs uppercase tracking-[0.22em] text-neutral-400">
                        Delta {formatScore(second.lookaheadDelta)} &bull; Pickrate{" "}
                        {formatPercentage(second.pickRate)}
                    </div>
                    <ContributionList
                        contributions={second.contributions}
                        total={second.breakdown.total}
                    />
                </div>
            </div>
        </div>
    );
};

const ContributionList: Component<{
    contributions: ScoreContribution[];
    total: number;
}> = (props) => (
    <div class="space-y-2 text-xs text-neutral-300">
        <For each={props.contributions}>
            {(item) => (
                <div class="flex flex-col gap-1">
                    <div class="flex items-center justify-between gap-3">
                        <span title={item.description}>
                            {item.label}
                            <Show when={item.weightLabel}>
                                {(label) => (
                                    <span class="ml-1 text-[11px] text-neutral-500">
                                        ({label()})
                                    </span>
                                )}
                            </Show>
                        </span>
                        <span class={scoreTextClass(item.weighted)}>
                            {formatScore(item.weighted)}
                        </span>
                    </div>
                    <Show when={item.weight !== 1}>
                        <div class="text-right text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                            {formatScore(item.base)} x {item.weight.toFixed(2)}
                        </div>
                    </Show>
                </div>
            )}
        </For>
        <div class="flex justify-between border-t border-neutral-800/60 pt-2 text-sm font-semibold text-neutral-200">
            <span>Total</span>
            <span class={scoreTextClass(props.total)}>
                {formatScore(props.total)}
            </span>
        </div>
    </div>
);

const EmptyRecommendations: Component<{ teamLabel: string }> = (props) => (
    <div class="flex h-full items-center justify-center rounded-2xl border border-dashed border-neutral-800/70 bg-neutral-950/30 p-10 text-center text-sm text-neutral-500">
        Aucun pick disponible pour {props.teamLabel}. Ajustez votre recherche ou
        selectionnez un slot actif pour afficher de nouvelles recommandations
        meta.
    </div>
);

function getRecommendationStatus(
    championKey: string,
    banned: Set<string>,
    ally: Set<string>,
    enemy: Set<string>
): RecommendationStatus {
    if (banned.has(championKey)) return "banned";
    if (ally.has(championKey) || enemy.has(championKey)) return "picked";
    return "eligible";
}

function computeComboItems({
    engine,
    baselineScore,
    teamMap,
    enemyMap,
    roleRecommendations,
}: {
    engine: DraftEngine;
    baselineScore: number;
    teamMap: Map<Role, string>;
    enemyMap: Map<Role, string>;
    roleRecommendations: RoleRecommendation[];
}): CarouselComboItem[] {
    const combos: CarouselComboItem[] = [];
    if (roleRecommendations.length < 2) return combos;

    for (let i = 0; i < roleRecommendations.length; i++) {
        for (let j = i + 1; j < roleRecommendations.length; j++) {
            const firstRole = roleRecommendations[i];
            const secondRole = roleRecommendations[j];
            const firstCandidates = firstRole.picks.slice(
                0,
                MAX_COMBO_VARIANTS_PER_ROLE
            );
            const secondCandidates = secondRole.picks.slice(
                0,
                MAX_COMBO_VARIANTS_PER_ROLE
            );

            for (const first of firstCandidates) {
                for (const second of secondCandidates) {
                    if (first.championKey === second.championKey) continue;

                    const map = new Map(teamMap);
                    map.set(first.role, first.championKey);
                    map.set(second.role, second.championKey);

                    const result = evaluateDraft(engine, map, enemyMap);
                    if (!result) continue;

                    const combinedScore = result.totalScore;
                    const combinedDelta = combinedScore - baselineScore;
                    const synergyDelta =
                        combinedDelta -
                        first.immediateDelta -
                        second.immediateDelta;

                    combos.push({
                        type: "combo",
                        picks: [first, second],
                        combinedScore,
                        combinedDelta,
                        synergyDelta,
                    });
                }
            }
        }
    }

    combos.sort((a, b) => b.combinedDelta - a.combinedDelta);
    return combos;
}

const modulo = (value: number, mod: number) =>
    ((value % mod) + mod) % mod;

function computeRoleRecommendations({
    engine,
    role,
    teamMap,
    enemyMap,
    baselineScore,
    openRoles,
    used,
    bans,
    searchTerm,
    dataset,
    roleTotals,
    minPickRate,
    config,
}: {
    engine: DraftEngine;
    role: Role;
    teamMap: Map<Role, string>;
    enemyMap: Map<Role, string>;
    baselineScore: number;
    openRoles: Role[];
    used: Set<string>;
    bans: string[];
    searchTerm?: string;
    dataset?: Dataset;
    roleTotals?: Map<Role, number>;
    minPickRate: number;
    config: DraftGapConfig;
}): PickRecommendation[] {
    const remainingRoles = openRoles.filter((openRole) => openRole !== role);
    const candidates = generateRoleCandidates({
        engine,
        role,
        teamMap,
        enemyMap,
        used,
        bans,
        limit: ROLE_BRANCHING_FACTOR,
    });

    const threshold =
        dataset && roleTotals && minPickRate > 0 ? minPickRate : 0;

    const evaluated = candidates
        .map((candidate) =>
            evaluateCandidate({
                candidate,
                engine,
                role,
                teamMap,
                enemyMap,
                baselineScore,
                remainingRoles,
                used,
                dataset,
                roleTotals,
            })
        )
        .map((rec) => ({
            ...rec,
            isMeta: isMetaPick(rec.pickRate, threshold),
        }))
        .sort((a, b) => b.lookaheadDelta - a.lookaheadDelta);

    const qualified = evaluated.filter((rec) => rec.isMeta);
    const offMeta = evaluated.filter((rec) => !rec.isMeta);

    if (!searchTerm || !dataset) {
        return selectRecommendations(
            qualified.map((rec) => (rec.isMeta ? rec : { ...rec, isMeta: true })),
            offMeta.map((rec) =>
                rec.isMeta ? { ...rec, isMeta: false } : rec
            )
        );
    }

    const searchRecommendations = buildSearchRecommendations({
        searchTerm,
        engine,
        role,
        teamMap,
        enemyMap,
        baselineScore,
        remainingRoles,
        used,
        bans,
        dataset,
        roleTotals,
        minPickRate: threshold,
        config,
    });
    searchRecommendations.sort((a, b) => b.lookaheadDelta - a.lookaheadDelta);

    const merged = mergeRecommendationLists(searchRecommendations, evaluated);
    const mergedQualified = merged
        .filter((rec) => isMetaPick(rec.pickRate, threshold))
        .map((rec) => (rec.isMeta ? rec : { ...rec, isMeta: true }));
    const mergedOffMeta = merged
        .filter((rec) => !isMetaPick(rec.pickRate, threshold))
        .map((rec) => (rec.isMeta ? { ...rec, isMeta: false } : rec));

    return selectRecommendations(mergedQualified, mergedOffMeta);
}

function selectRecommendations(
    qualified: PickRecommendation[],
    fallback: PickRecommendation[]
) {
    const results: PickRecommendation[] = [];
    const qualifiedTarget = Math.min(MIN_PICKRATE_RESULTS, MAX_RESULTS_PER_ROLE);

    let qualifiedIndex = 0;
    while (
        results.length < qualifiedTarget &&
        qualifiedIndex < qualified.length
    ) {
        results.push(qualified[qualifiedIndex++]);
    }

    let fallbackIndex = 0;
    while (results.length < MAX_RESULTS_PER_ROLE && fallbackIndex < fallback.length) {
        results.push(fallback[fallbackIndex++]);
    }

    while (results.length < MAX_RESULTS_PER_ROLE && qualifiedIndex < qualified.length) {
        results.push(qualified[qualifiedIndex++]);
    }

    while (results.length < MAX_RESULTS_PER_ROLE && fallbackIndex < fallback.length) {
        results.push(fallback[fallbackIndex++]);
    }

    return results.slice(0, MAX_RESULTS_PER_ROLE);
}

function evaluateCandidate({
    candidate,
    engine,
    role,
    teamMap,
    enemyMap,
    baselineScore,
    remainingRoles,
    used,
    dataset,
    roleTotals,
}: {
    candidate: DraftCandidateScore;
    engine: DraftEngine;
    role: Role;
    teamMap: Map<Role, string>;
    enemyMap: Map<Role, string>;
    baselineScore: number;
    remainingRoles: Role[];
    used: Set<string>;
    dataset?: Dataset;
    roleTotals?: Map<Role, number>;
}): PickRecommendation {
    const candidateMap = new Map(teamMap);
    candidateMap.set(role, candidate.pick.championKey);
    const usedAfterPick = new Set(used);
    usedAfterPick.add(candidate.pick.championKey);

    const continuationScore = computeBeamContinuation({
        engine,
        initialState: {
            teamMap: candidateMap,
            used: usedAfterPick,
            remainingRoles: remainingRoles.slice(),
            score: candidate.draftScore,
        },
        enemyMap,
    });

    const projectedScore = Math.max(candidate.draftScore, continuationScore);
    const contributions = buildScoreContributions(
        candidate.pick,
        engine.weights
    );

    const pickRate = computePickRate(
        candidate.pick.championKey,
        role,
        dataset,
        roleTotals
    );

    const flexRoles = computeFlexRoles({
        championKey: candidate.pick.championKey,
        primaryRole: role,
        dataset,
    });

    const synergyPartner = findBestSynergyPartner({
        engine,
        championKey: candidate.pick.championKey,
        teamMap,
    });

    const counterTarget = findBestCounterTarget({
        engine,
        championKey: candidate.pick.championKey,
        role,
        enemyMap,
    });

    const reasonTags = buildReasonTags({ contributions });

    return {
        championKey: candidate.pick.championKey,
        role,
        lookaheadDelta: projectedScore - baselineScore,
        immediateDelta: candidate.draftScore - baselineScore,
        teamScore: candidate.draftScore,
        projectedScore,
        pickRate,
        isMeta: false,
        breakdown: candidate.pick,
        contributions,
        flexRoles,
        synergyPartner,
        counterTarget,
        denyScore: candidate.pick.deny,
        exposureScore: candidate.pick.exposure,
        reasonTags,
    };
}

function computeFlexRoles({
    championKey,
    primaryRole,
    dataset,
}: {
    championKey: string;
    primaryRole: Role;
    dataset?: Dataset;
}): FlexOption[] {
    if (!dataset) return [];
    const champion = dataset.championData[championKey];
    if (!champion) return [];

    const entries = ROLES.map((role) => ({
        role,
        games: champion.statsByRole[role]?.games ?? 0,
    })).filter((entry) => entry.role !== primaryRole && entry.games > 0);

    if (!entries.length) return [];

    const total = entries.reduce((sum, entry) => sum + entry.games, 0);
    if (total <= 0) return [];

    return entries
        .map((entry) => ({
            role: entry.role,
            share: entry.games / total,
        }))
        .filter((entry) => entry.share >= 0.05)
        .sort((a, b) => b.share - a.share);
}

function findBestSynergyPartner({
    engine,
    championKey,
    teamMap,
}: {
    engine: DraftEngine;
    championKey: string;
    teamMap: Map<Role, string>;
}): SynergyHighlight | undefined {
    let best: SynergyHighlight | undefined;
    for (const allyChampion of teamMap.values()) {
        if (!allyChampion || allyChampion === championKey) continue;
        const entry = engine.index.getSynergyScore(championKey, allyChampion);
        if (!entry) continue;
        if (!best || entry.score > best.score) {
            best = {
                championKey: allyChampion,
                score: entry.score,
            };
        }
    }
    return best && best.score > 0 ? best : undefined;
}

function findBestCounterTarget({
    engine,
    championKey,
    role,
    enemyMap,
}: {
    engine: DraftEngine;
    championKey: string;
    role: Role;
    enemyMap: Map<Role, string>;
}): CounterHighlight | undefined {
    const draftRole = roleIdToDraftRole(role);
    if (!draftRole) return undefined;
    let best: CounterHighlight | undefined;

    for (const enemyChampion of enemyMap.values()) {
        if (!enemyChampion) continue;
        const entry = engine.index.getCounterEntry(
            draftRole,
            championKey,
            enemyChampion
        );
        if (!entry) continue;
        if (!best || entry.score > best.score) {
            best = {
                championKey: enemyChampion,
                score: entry.score,
            };
        }
    }

    return best && best.score > 0 ? best : undefined;
}

function buildReasonTags({
    contributions,
}: {
    contributions: ScoreContribution[];
}): ReasonTag[] {
    const tags: ReasonTag[] = [];
    for (const contribution of contributions) {
        const id = normalizeReasonKey(contribution.label);
        if (!id) continue;
        const value = contribution.weighted;
        if (Math.abs(value) < 0.05) continue;
        tags.push({
            id,
            label: contribution.label,
            value,
            weight: contribution.weight,
            positive: value >= 0,
        });
    }
    return tags.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 5);
}

function normalizeReasonKey(label: string): ReasonKey | undefined {
    const lower = label.toLowerCase();
    if (lower.includes("intrinsic")) return "intrinsic";
    if (lower.includes("fiabil")) return "reliability";
    if (lower.includes("blind")) return "blind";
    if (lower.includes("flex")) return "flex";
    if (lower.includes("synergie")) return "synergy";
    if (lower.includes("counter")) return "counter";
    if (lower.includes("deny")) return "deny";
    if (lower.includes("exposition")) return "exposure";
    return undefined;
}

function buildSearchRecommendations({
    searchTerm,
    engine,
    role,
    teamMap,
    enemyMap,
    baselineScore,
    remainingRoles,
    used,
    bans,
    dataset,
    roleTotals,
    minPickRate,
    config,
}: {
    searchTerm: string;
    engine: DraftEngine;
    role: Role;
    teamMap: Map<Role, string>;
    enemyMap: Map<Role, string>;
    baselineScore: number;
    remainingRoles: Role[];
    used: Set<string>;
    bans: string[];
    dataset: Dataset;
    roleTotals?: Map<Role, number>;
    minPickRate: number;
    config: DraftGapConfig;
}): PickRecommendation[] {
    const draftRole = roleIdToDraftRole(role);
    const banned = new Set(bans);
    const seen = new Set<string>();
    const results: PickRecommendation[] = [];

    for (const entry of engine.data.championRoleMetrics) {
        if (entry.role !== draftRole) continue;
        const championKey = entry.championKey;
        if (seen.has(championKey)) continue;
        if (used.has(championKey) || banned.has(championKey)) continue;
        if (!matchesSearchTerm(championKey, searchTerm, dataset, config)) {
            continue;
        }
        const candidate = scoreCandidate(engine, teamMap, enemyMap, {
            role,
            championKey,
        });
        if (!candidate) continue;
        seen.add(championKey);
        results.push(
            evaluateCandidate({
                candidate,
                engine,
                role,
                teamMap,
                enemyMap,
                baselineScore,
                remainingRoles,
                used,
                dataset,
                roleTotals,
            })
        );
    }

    const decorated = results.map((rec) => ({
        ...rec,
        isMeta: isMetaPick(rec.pickRate, minPickRate),
    }));

    return minPickRate > 0
        ? decorated.filter((rec) => rec.isMeta)
        : decorated;
}

function mergeRecommendationLists(
    primary: PickRecommendation[],
    secondary: PickRecommendation[]
) {
    const seen = new Set<string>();
    const results: PickRecommendation[] = [];

    for (const recommendation of primary) {
        if (seen.has(recommendation.championKey)) continue;
        results.push(recommendation);
        seen.add(recommendation.championKey);
    }

    for (const recommendation of secondary) {
        if (seen.has(recommendation.championKey)) continue;
        results.push(recommendation);
        seen.add(recommendation.championKey);
    }

    return results;
}

function matchesSearchTerm(
    championKey: string,
    searchTerm: string,
    dataset: Dataset,
    config: DraftGapConfig
) {
    const champion = dataset.championData[championKey];
    if (!champion) return false;
    if (normalizeSearchValue(champion.name).includes(searchTerm)) return true;
    const localized = championName(champion, config);
    return normalizeSearchValue(localized).includes(searchTerm);
}

function computeRoleTotals(dataset: Dataset) {
    const totals = new Map<Role, number>();
    for (const role of ROLES) {
        totals.set(role, 0);
    }
    for (const champion of Object.values(dataset.championData)) {
        for (const role of ROLES) {
            const stats = champion.statsByRole[role];
            totals.set(role, (totals.get(role) ?? 0) + (stats?.games ?? 0));
        }
    }
    return totals;
}

function computePickRate(
    championKey: string,
    role: Role,
    dataset?: Dataset,
    roleTotals?: Map<Role, number>
) {
    if (!dataset) return 0;
    const champion = dataset.championData[championKey];
    if (!champion) return 0;
    const roleStats = champion.statsByRole[role];
    const games = roleStats?.games ?? 0;
    const totalGames = roleTotals?.get(role) ?? 0;
    if (!totalGames || totalGames <= 0) return 0;
    return Math.max(games / totalGames, 0);
}

function generateRoleCandidates({
    engine,
    role,
    teamMap,
    enemyMap,
    used,
    bans,
    limit,
}: {
    engine: DraftEngine;
    role: Role;
    teamMap: Map<Role, string>;
    enemyMap: Map<Role, string>;
    used: Set<string>;
    bans: string[];
    limit: number;
}): DraftCandidateScore[] {
    const draftRole = roleIdToDraftRole(role);
    const banned = new Set(bans);
    const entries = engine.data.championRoleMetrics.filter(
        (entry) => entry.role === draftRole
    );

    const results: DraftCandidateScore[] = [];
    for (const entry of entries) {
        if (used.has(entry.championKey) || banned.has(entry.championKey)) {
            continue;
        }
        const candidate: DraftPickDescriptor = {
            role,
            championKey: entry.championKey,
        };
        const result = scoreCandidate(engine, teamMap, enemyMap, candidate);
        if (!result) continue;
        results.push(result);
        if (results.length >= limit * 2) {
            break;
        }
    }

    return results
        .sort((a, b) => b.draftScore - a.draftScore)
        .slice(0, limit);
}

type BeamState = {
    teamMap: Map<Role, string>;
    used: Set<string>;
    remainingRoles: Role[];
    score: number;
};

function computeBeamContinuation({
    engine,
    initialState,
    enemyMap,
}: {
    engine: DraftEngine;
    initialState: BeamState;
    enemyMap: Map<Role, string>;
}) {
    let bestScore = initialState.score;
    let frontier: BeamState[] = [initialState];

    for (
        let depth = 0;
        depth < LOOKAHEAD_DEPTH && frontier.length > 0;
        depth++
    ) {
        const nextStates: BeamState[] = [];

        for (const state of frontier) {
            if (state.remainingRoles.length === 0) {
                nextStates.push(state);
                bestScore = Math.max(bestScore, state.score);
                continue;
            }

            const nextRole = state.remainingRoles[0];
            const candidates = generateRoleCandidates({
                engine,
                role: nextRole,
                teamMap: state.teamMap,
                enemyMap,
                used: state.used,
                bans: [],
                limit: ROLE_BRANCHING_FACTOR,
            });

            for (const candidate of candidates) {
                const championKey = candidate.pick.championKey;
                if (state.used.has(championKey)) continue;

                const teamMap = new Map(state.teamMap);
                teamMap.set(nextRole, championKey);
                const used = new Set(state.used);
                used.add(championKey);
                const remainingRoles = state.remainingRoles.slice(1);

                const score = candidate.draftScore;
                bestScore = Math.max(bestScore, score);

                nextStates.push({
                    teamMap,
                    used,
                    remainingRoles,
                    score,
                });
            }
        }

        if (!nextStates.length) break;
        nextStates.sort((a, b) => b.score - a.score);
        frontier = nextStates.slice(0, BEAM_WIDTH);
    }

    return bestScore;
}

function roleIdToDraftRole(role: Role) {
    switch (role) {
        case Role.Top:
            return "top";
        case Role.Jungle:
            return "jng";
        case Role.Middle:
            return "mid";
        case Role.Bottom:
            return "bot";
        case Role.Support:
            return "sup";
    }
}

function scoreTextClass(value: number) {
    if (value > 0.01) return "text-emerald-300";
    if (value < -0.01) return "text-rose-300";
    return "text-neutral-300";
}

function formatPercentage(value: number) {
    if (!Number.isFinite(value) || value <= 0) return "0%";
    const percentage = value * 100;
    if (percentage >= 99.95) return "100%";
    const precision = percentage >= 10 ? 1 : 2;
    return `${percentage.toFixed(precision)}%`;
}

function formatScore(value: number) {
    const rounded = value.toFixed(2);
    return value >= 0 ? `+${rounded}` : rounded;
}

function buildScoreContributions(
    pick: DraftCandidateScore["pick"],
    weights: DraftEngine["weights"]
): ScoreContribution[] {
    return [
        {
            label: "Intrinsic",
            weighted: pick.intrinsic,
            base: pick.intrinsic,
            weight: 1,
            description:
                "Performance moyenne du champion independamment du contexte de draft.",
        },
        {
            label: "Fiabilite",
            weighted: pick.reliability * weights.k1,
            base: pick.reliability,
            weight: weights.k1,
            weightLabel: "k1",
            description:
                "Stabilite du pick selon l'historique de resultats et la variance observee.",
        },
        {
            label: "Blind",
            weighted: pick.blind * weights.k2,
            base: pick.blind,
            weight: weights.k2,
            weightLabel: "k2",
            description:
                "Capacite du champion a etre selectionne tot sans se faire punir.",
        },
        {
            label: "Flexibilite",
            weighted: pick.flex * weights.k3,
            base: pick.flex,
            weight: weights.k3,
            weightLabel: "k3",
            description:
                "Options de flex permettant de brouiller les matchups adverses.",
        },
        {
            label: "Synergie",
            weighted: pick.synergy * weights.k4,
            base: pick.synergy,
            weight: weights.k4,
            weightLabel: "k4",
            description:
                "Compatibilite du champion avec ceux deja selectionnes dans votre equipe.",
        },
        {
            label: "Counter",
            weighted: pick.counter * weights.k5,
            base: pick.counter,
            weight: weights.k5,
            weightLabel: "k5",
            description:
                "Avantage direct obtenu sur les selections adverses actuelles.",
        },
        {
            label: "Deny",
            weighted: pick.deny * weights.k6,
            base: pick.deny,
            weight: weights.k6,
            weightLabel: "k6",
            description:
                "Valeur retiree a l'adversaire en bloquant ses meilleures options.",
        },
        {
            label: "Exposition",
            weighted: -pick.exposure * weights.k7,
            base: pick.exposure,
            weight: -weights.k7,
            weightLabel: "-k7",
            description:
                "Penalite liee aux contre-picks ou faiblesses identifiees.",
        },
    ];
}

function toRoleMap(
    team:
        | ReturnType<typeof useDraft>["allyTeam"]
        | ReturnType<typeof useDraft>["opponentTeam"]
) {
    const map = new Map<Role, string>();
    for (const entry of team) {
        if (entry.role !== undefined && entry.championKey) {
            map.set(entry.role, entry.championKey);
        }
    }
    return map;
}

function buildUsedSet(
    teamMap: Map<Role, string>,
    enemyMap: Map<Role, string>,
    bans: string[]
) {
    const used = new Set<string>();
    for (const value of teamMap.values()) {
        used.add(value);
    }
    for (const value of enemyMap.values()) {
        used.add(value);
    }
    for (const ban of bans) {
        used.add(ban);
    }
    return used;
}

export default QuickPickRecommendations;
