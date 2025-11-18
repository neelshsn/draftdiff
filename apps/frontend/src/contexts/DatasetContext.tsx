import {
    JSXElement,
    createContext,
    createEffect,
    createMemo,
    createResource,
    createSignal,
    useContext,
} from "solid-js";
import {
    DATASET_VERSION,
    Dataset,
} from "@draftgap/core/src/models/dataset/Dataset";
import {
    PrecomputedDraftMetrics,
    draftRoleToRoleId,
    roleIdToDraftRole,
} from "@draftgap/core/src/draft/metrics";
import {
    createDraftEngine,
    DraftEngine,
} from "@draftgap/core/src/draft/engine";
import type { DataSource } from "@draftgap/core/src/models/user/Config";
import { useUser } from "./UserContext";
import {
    getProTeamDataset,
    getProTeamDataset30Days,
    getProTeamNames,
    getProTeamRoster,
    getProAvailablePatches,
    invalidateProDatasets,
    loadProDatasets,
} from "../data/proDataset";
import { createErrorToast } from "../utils/toast";
import { ROLES, Role } from "@draftgap/core/src/models/Role";
import { safeDivide } from "@draftgap/core/src/draft/math";

type BundledDatasetName = "current-patch" | "30-days";

const bundledDatasetsCache: Partial<Record<BundledDatasetName, Dataset | null>> =
    {};

const loadBundledDataset = async (
    name: BundledDatasetName
): Promise<Dataset | undefined> => {
    const cached = bundledDatasetsCache[name];
    if (cached !== undefined) {
        return cached ?? undefined;
    }

    try {
        const module =
            name === "current-patch"
                ? await import("../../../../data/current-patch.json?raw")
                : await import("../../../../data/30-days.json?raw");
        const parsed = JSON.parse(module.default) as Dataset;
        bundledDatasetsCache[name] = parsed;
        return parsed;
    } catch (error) {
        console.error(`Failed to load bundled dataset ${name}`, error);
        bundledDatasetsCache[name] = null;
        return undefined;
    }
};

const normalizeChampionIdentifier = (value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const ensureBundledChampionKeyMap = async () => {
    if (bundledChampionKeyMap !== undefined) {
        return bundledChampionKeyMap ?? undefined;
    }

    const dataset = await loadBundledDataset("current-patch");
    if (!dataset) {
        bundledChampionKeyMap = null;
        return undefined;
    }

    const map = new Map<string, string>();
    for (const [key, champion] of Object.entries(dataset.championData)) {
        const register = (identifier?: string | number) => {
            if (identifier === undefined || identifier === null) return;
            const normalized = normalizeChampionIdentifier(String(identifier));
            if (!normalized) return;
            map.set(normalized, key);
        };
        register(champion.id);
        register(champion.key);
        register(champion.name);
    }

    bundledChampionKeyMap = map;
    return map;
};

const remapChampionKey = (
    championKey: string,
    map: Map<string, string>
) =>
    map.get(normalizeChampionIdentifier(championKey)) ?? championKey;

const normaliseMetricsChampionKeys = (
    metrics: PrecomputedDraftMetrics,
    map: Map<string, string>
) => {
    for (const entry of metrics.championRoleMetrics) {
        entry.championKey = remapChampionKey(entry.championKey, map);
        entry.opponents = entry.opponents.map((opponent) => ({
            ...opponent,
            championKey: remapChampionKey(opponent.championKey, map),
        }));
    }

    for (const entry of metrics.championFlexMetrics) {
        entry.championKey = remapChampionKey(entry.championKey, map);
    }

    for (const entry of metrics.synergyMatrix) {
        entry.championA = remapChampionKey(entry.championA, map);
        entry.championB = remapChampionKey(entry.championB, map);
    }

    for (const entry of metrics.counterMatrix) {
        entry.champion = remapChampionKey(entry.champion, map);
        entry.opponent = remapChampionKey(entry.opponent, map);
    }

    for (const entry of metrics.playerReliability) {
        entry.championKey = remapChampionKey(entry.championKey, map);
    }
};

const INTRINSIC_SCALE = 12;
const BLIND_SCALE = 6;
const INTRINSIC_BLEND = 0.65;
const BLIND_BLEND = 0.5;
const COMPONENT_BLEND = 0.4;

const cloneMetrics = (metrics: PrecomputedDraftMetrics) =>
    JSON.parse(JSON.stringify(metrics)) as PrecomputedDraftMetrics;

const computeRoleTotals = (dataset: Dataset) => {
    const totals = new Map<Role, { wins: number; games: number }>();
    for (const role of ROLES) {
        totals.set(role, { wins: 0, games: 0 });
    }
    for (const champion of Object.values(dataset.championData)) {
        for (const role of ROLES) {
            const stats = champion.statsByRole[role];
            const total = totals.get(role)!;
            total.wins += stats.wins;
            total.games += stats.games;
        }
    }
    return totals;
};

const adjustDraftMetricsForDataset = (
    metrics: PrecomputedDraftMetrics,
    dataset: Dataset
): PrecomputedDraftMetrics => {
    const cloned = cloneMetrics(metrics);
    const roleTotals = computeRoleTotals(dataset);
    const priorStrength =
        cloned.priors.winrate.n0 ?? metrics.priors.winrate.n0 ?? 12;
    let sampleSize = 0;

    for (const entry of cloned.championRoleMetrics) {
        const roleId = draftRoleToRoleId(entry.role);
        const champion = dataset.championData[entry.championKey];
        if (!champion) continue;
        const roleStats = champion.statsByRole[roleId];
        if (!roleStats || roleStats.games <= 0) continue;

        const roleTotal = roleTotals.get(roleId) ?? { wins: 0, games: 0 };
        const roleAverage = safeDivide(roleTotal.wins, roleTotal.games, 0.5);
        const smoothed = safeDivide(
            roleStats.wins + roleAverage * priorStrength,
            roleStats.games + priorStrength,
            roleAverage
        );
        const baseGames = entry.games > 0 ? entry.games : 1;
        const baseWinrate = safeDivide(entry.wins, baseGames, roleAverage);
        const delta = smoothed - baseWinrate;

        entry.games = roleStats.games;
        entry.wins = roleStats.wins;
        entry.winrateAdj = smoothed;
        entry.intrinsic =
            entry.intrinsic * (1 - INTRINSIC_BLEND) +
            delta * INTRINSIC_SCALE * INTRINSIC_BLEND;
        entry.blind =
            entry.blind * (1 - BLIND_BLEND) +
            delta * BLIND_SCALE * BLIND_BLEND;
        entry.componentBreakdown.lane =
            entry.componentBreakdown.lane * (1 - COMPONENT_BLEND) +
            delta * BLIND_SCALE * COMPONENT_BLEND;
        entry.reliability.relN = safeDivide(
            roleStats.games,
            roleStats.games + priorStrength,
            entry.reliability.relN
        );

        sampleSize += roleStats.games;
    }

    const roleGames = {
        top: 0,
        jng: 0,
        mid: 0,
        bot: 0,
        sup: 0,
    };
    const roleWinrate = {
        top: 0.5,
        jng: 0.5,
        mid: 0.5,
        bot: 0.5,
        sup: 0.5,
    };

    for (const [role, totals] of roleTotals.entries()) {
        const draftRole = roleIdToDraftRole(role);
        roleGames[draftRole] = totals.games;
        roleWinrate[draftRole] = safeDivide(
            totals.wins,
            totals.games,
            roleWinrate[draftRole]
        );
    }

    cloned.roleGames = roleGames;
    cloned.roleWinrate = roleWinrate;
    cloned.sampleSize = sampleSize || cloned.sampleSize;
    cloned.patch = dataset.version ?? cloned.patch;

    return cloned;
};

const fetchRemoteDataset = async (name: "30-days" | "current-patch") => {
    try {
        const response = await fetch(
            `https://bucket.draftgap.com/datasets/v${DATASET_VERSION}/${name}.json`,
            { cache: "no-store" }
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        return json as Dataset;
    } catch (err) {
        console.warn(
            `Failed to load ${name} dataset from network, attempting bundled fallback`,
            err
        );
        const fallback = await loadBundledDataset(
            name === "current-patch" ? "current-patch" : "30-days"
        );
        if (fallback) return fallback;
        console.error(`Failed to load ${name} dataset`, err);
        return undefined;
    }
};

const fetchDraftMetrics = async ({
    source,
    patch,
}: {
    source: DataSource;
    patch: string;
}): Promise<PrecomputedDraftMetrics | undefined> => {
    if (source === "pro") {
        try {
            const datasets = await loadProDatasets({ patch });
            return datasets.metrics;
        } catch (error) {
            console.error("Failed to load pro draft metrics", error);
            return undefined;
        }
    }

    try {
        const response = await fetch("/data/draft-metrics.json", {
            cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as PrecomputedDraftMetrics;
    } catch (error) {
        console.warn(
            "Primary fetch for draft metrics failed, attempting bundled fallback",
            error
        );
        const fallback = await loadBundledDraftMetrics();
        if (fallback) return fallback;
        console.error("Failed to load draft metrics", error);
        return undefined;
    }
};

type DatasetRequest = {
    source: DataSource;
    variant: "current" | "full";
    patch: string;
};

let hasWarnedAboutProDatasetFailure = false;
let bundledDraftMetricsCache: PrecomputedDraftMetrics | null | undefined;
let bundledChampionKeyMap:
    | Map<string, string>
    | null
    | undefined;

const loadBundledDraftMetrics = async (): Promise<
    PrecomputedDraftMetrics | undefined
> => {
    if (bundledDraftMetricsCache !== undefined) {
        return bundledDraftMetricsCache ?? undefined;
    }

    try {
        const module = await import(
            "../../../../data/draft-metrics.json?raw"
        );
        const parsed = JSON.parse(module.default) as PrecomputedDraftMetrics;
        const keyMap = await ensureBundledChampionKeyMap();
        if (keyMap) {
            normaliseMetricsChampionKeys(parsed, keyMap);
        }
        bundledDraftMetricsCache = parsed;
        return parsed;
    } catch (error) {
        console.error("Failed to load bundled draft metrics", error);
        bundledDraftMetricsCache = null;
        return undefined;
    }
};

const fetchDataset = async ({ source, variant, patch }: DatasetRequest) => {
    const fallbackName = variant === "current" ? "current-patch" : "30-days";

    try {
        if (source === "pro") {
            try {
                const datasets = await loadProDatasets({ patch });
                return variant === "current"
                    ? datasets.dataset
                    : datasets.dataset30Days;
            } catch (error) {
                console.error("Failed to load pro dataset", error);
                if (!hasWarnedAboutProDatasetFailure) {
                    hasWarnedAboutProDatasetFailure = true;
                    createErrorToast(
                        "Pro data unavailable. Falling back to Riot data."
                    );
                }
                return await fetchRemoteDataset(fallbackName);
            }
        }

        return await fetchRemoteDataset(fallbackName);
    } catch (error) {
        console.error("Failed to load dataset", error);
        return undefined;
    }
};

function createDatasetContext() {
    const { config } = useUser();

    const [dataset, { refetch: refetchDataset }] = createResource(
        () => ({
            source: config.dataSource,
            variant: "current" as const,
            patch: config.proPatch,
        }),
        fetchDataset
    );

    const [draftMetrics, { refetch: refetchDraftMetrics }] =
        createResource(
            () => ({
                source: config.dataSource,
                patch: config.proPatch,
            }),
            fetchDraftMetrics
        );

    let scopedEngineCache = new WeakMap<Dataset, DraftEngine>();
    const [proPatches, setProPatches] = createSignal<string[]>([]);

    createEffect(() => {
        void draftMetrics();
        scopedEngineCache = new WeakMap();
    });

    createEffect(() => {
        void dataset();
        scopedEngineCache = new WeakMap();
    });

    createEffect(() => {
        if (config.dataSource === "pro" && dataset()) {
            setProPatches(getProAvailablePatches());
        } else {
            setProPatches([]);
        }
    });

    const getScopedDraftEngine = (targetDataset?: Dataset) => {
        const datasetInstance = targetDataset ?? dataset();
        if (!datasetInstance) return undefined;

        const cached = scopedEngineCache.get(datasetInstance);
        if (cached) return cached;

        const metrics = draftMetrics();
        if (!metrics) return undefined;

        try {
            const adjusted = adjustDraftMetricsForDataset(
                metrics,
                datasetInstance
            );
            const engine = createDraftEngine(adjusted);
            scopedEngineCache.set(datasetInstance, engine);
            return engine;
        } catch (error) {
            console.error("Failed to create draft engine", error);
            return undefined;
        }
    };

    const draftEngine = createMemo<DraftEngine | undefined>(() =>
        getScopedDraftEngine()
    );

    const [dataset30Days, { refetch: refetchDataset30Days }] = createResource(
        () => ({
            source: config.dataSource,
            variant: "full" as const,
            patch: config.proPatch,
        }),
        fetchDataset
    );

    const [proTeams, setProTeams] = createSignal<string[]>([]);

    const isLoaded = () =>
        dataset() !== undefined && dataset30Days() !== undefined;

    const patchLabel = () => {
        const current = dataset();
        if (!current) return undefined;
        const label =
            (current as Dataset & { patchLabel?: string }).patchLabel ??
            current.version;
        if (config.dataSource === "pro") {
            if (config.proPatch === "all") {
                return "Tous les patchs";
            }
            return label;
        }
        return label;
    };

    const reload = async () => {
        if (config.dataSource === "pro") {
            invalidateProDatasets();
            hasWarnedAboutProDatasetFailure = false;
        }
        await Promise.all([
            refetchDataset(),
            refetchDataset30Days(),
            refetchDraftMetrics(),
        ]);
    };

    createEffect(() => {
        if (config.dataSource === "pro" && dataset()) {
            setProTeams(getProTeamNames());
        } else {
            setProTeams([]);
        }
    });

    createEffect(() => {
        (window as any).DRAFTGAP_DEBUG = (window as any).DRAFTGAP_DEBUG || {};
        (window as any).DRAFTGAP_DEBUG.dataset = dataset;
        (window as any).DRAFTGAP_DEBUG.dataset30Days = dataset30Days;
    });

    return {
        dataset,
        dataset30Days,
        isLoaded,
        patchLabel,
        reload,
        proTeams,
        proPatches,
        draftMetrics,
        draftEngine,
        getScopedDraftEngine,
        getProTeamDataset: (teamName: string) =>
            config.dataSource === "pro"
                ? getProTeamDataset(teamName)
                : undefined,
        getProTeamDataset30Days: (teamName: string) =>
            config.dataSource === "pro"
                ? getProTeamDataset30Days(teamName)
                : undefined,
        getProTeamRoster: (teamName: string) =>
            config.dataSource === "pro"
                ? getProTeamRoster(teamName)
                : undefined,
    };
}

const DatasetContext = createContext<ReturnType<typeof createDatasetContext>>();

export function DatasetProvider(props: { children: JSXElement }) {
    return (
        <DatasetContext.Provider value={createDatasetContext()}>
            {props.children}
        </DatasetContext.Provider>
    );
}

export function useDataset() {
    const useCtx = useContext(DatasetContext);
    if (!useCtx) throw new Error("No DatasetContext found");

    return useCtx;
}
