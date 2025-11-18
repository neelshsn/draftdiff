import { Accessor, JSXElement, createContext, createMemo, useContext } from "solid-js";
import { Suggestion, getSuggestions, DraftStage } from "@draftgap/core/src/draft/suggestions";
import { useDraftAnalysis } from "./DraftAnalysisContext";
import { useDataset } from "./DatasetContext";
import { useDraft } from "./DraftContext";
import { ROLES, Role } from "@draftgap/core/src/models/Role";
import { DraftStrategy, useDraftStrategy } from "./DraftStrategyContext";
import { MIN_BLIND_PICK_RATE } from "../constants/draft";

const LOW_DATA_IMPACT_PENALTY = 0.2;
const LOW_PICK_RATE_NO_PENALTY = 0.03;
const RELIABILITY_IMPACT_PENALTY = 0.2;
const MIN_LOW_SAMPLE_PENALTY = 0.1;
const MAX_IMPACT_PENALTY = 0.25;
const LOW_PRIORITY_PICK_RATE = 0.003;

export type BanTarget = {
    role: Role;
    suggestion?: Suggestion;
};

export type StrategySuggestion = Suggestion & {
    strategyScore: number;
    gated: boolean;
    lowPriority: boolean;
    effectiveMu: number;
    effectiveUtility: number;
};

function computeStrategyScore(
    suggestion: Suggestion,
    strategy: DraftStrategy,
    effectiveMu: number,
    effectiveUtility: number,
    reliabilityFactor: number
): number {
    const counterSafety = 1 - Math.min(1, Math.max(0, suggestion.counterRisk));

    let value = effectiveUtility;
    value += effectiveMu * 120 * (0.7 + 0.3 * reliabilityFactor);
    value += suggestion.coverScore * 10 * (0.5 + reliabilityFactor);
    value += suggestion.flexScore * 6;
    value += suggestion.urgency * 12 * (0.4 + 0.6 * reliabilityFactor);
    value -= suggestion.counterRisk * 12 * (1.1 - 0.4 * reliabilityFactor);

    switch (strategy) {
        case "teamfight":
            value += Math.max(0, suggestion.coverScore) * 18 * (0.5 + reliabilityFactor / 2);
            value += Math.max(0, suggestion.trendScore) * 8 * (0.4 + 0.6 * reliabilityFactor);
            value += counterSafety * 6;
            break;
        case "split":
            value += suggestion.flexScore * 18;
            value += Math.max(0, suggestion.trendScore) * 6 * (0.4 + 0.6 * reliabilityFactor);
            value += counterSafety * 4;
            break;
        case "protect":
            value += suggestion.blindSafety * 28 * (0.5 + reliabilityFactor / 2);
            value += reliabilityFactor * 40;
            value += counterSafety * 12;
            break;
        case "poke":
            value += Math.max(0, suggestion.trendScore) * 16 * (0.4 + 0.6 * reliabilityFactor);
            value += counterSafety * 8;
            break;
        case "catch":
            value += counterSafety * 18;
            value += suggestion.urgency * 12 * (0.5 + reliabilityFactor / 2);
            break;
        default:
            value += effectiveMu * 90;
    }

    return value;
}

function applyStrategyWeight(
    suggestions: Suggestion[],
    strategy: DraftStrategy,
    opponentComp: Map<Role, string>
): StrategySuggestion[] {
    const opponentHasRole = (role: Role) =>
        opponentComp?.has(role) ?? false;

    const compareByImpact = (a: StrategySuggestion, b: StrategySuggestion) => {
        if (b.effectiveMu !== a.effectiveMu) return b.effectiveMu - a.effectiveMu;
        if (b.strategyScore !== a.strategyScore) {
            return b.strategyScore - a.strategyScore;
        }
        if (b.effectiveUtility !== a.effectiveUtility) {
            return b.effectiveUtility - a.effectiveUtility;
        }
        if (b.utility !== a.utility) return b.utility - a.utility;
        return b.sampleSize - a.sampleSize;
    };

    const computeImpactPenalty = (suggestion: Suggestion) => {
        const pickRate = Number.isFinite(suggestion.pickRate)
            ? Math.max(0, suggestion.pickRate ?? 0)
            : 0;
        let pickRatePenalty = 0;
        if (LOW_PICK_RATE_NO_PENALTY > 0 && pickRate < LOW_PICK_RATE_NO_PENALTY) {
            const scale = 1 - pickRate / LOW_PICK_RATE_NO_PENALTY;
            pickRatePenalty =
                LOW_DATA_IMPACT_PENALTY *
                Math.min(1, Math.max(0, scale));
        }

        const reliabilityWeight = Number.isFinite(suggestion.reliabilityWeight)
            ? Math.min(Math.max(suggestion.reliabilityWeight ?? 0, 0), 1)
            : 0;
        const reliabilityPenalty =
            (1 - reliabilityWeight) * RELIABILITY_IMPACT_PENALTY;

        let penalty = pickRatePenalty + reliabilityPenalty;

        if (suggestion.sampleSize > 0 && suggestion.sampleSize <= 3) {
            penalty = Math.max(penalty, MIN_LOW_SAMPLE_PENALTY);
        }

        penalty = Math.min(penalty, MAX_IMPACT_PENALTY);

        return penalty;
    };

    const scored = suggestions.map((suggestion) => {
        const penalty = computeImpactPenalty(suggestion);
        const reliabilityFactor = Number.isFinite(suggestion.reliabilityWeight)
            ? Math.max(
                  0,
                  Math.min(1, suggestion.reliabilityWeight ?? 0)
              )
            : 0;
        const adjustedMu = suggestion.mu * reliabilityFactor;
        const effectiveMu = adjustedMu - penalty;
        const utilityScale = 0.4 + 0.6 * reliabilityFactor;
        const effectiveUtility =
            suggestion.utility * utilityScale - penalty * 140;
        const strategyScore = computeStrategyScore(
            suggestion,
            strategy,
            effectiveMu,
            effectiveUtility,
            reliabilityFactor
        );
        const lowPriority = suggestion.pickRate < LOW_PRIORITY_PICK_RATE;
        const gated =
            suggestion.pickRate < MIN_BLIND_PICK_RATE &&
            !opponentHasRole(suggestion.role);
        return {
            ...suggestion,
            strategyScore,
            gated,
            lowPriority,
            effectiveMu,
            effectiveUtility,
        };
    });

    const eligible: StrategySuggestion[] = [];
    const delayed: StrategySuggestion[] = [];

    for (const suggestion of scored) {
        if (suggestion.gated || suggestion.lowPriority) {
            delayed.push(suggestion);
        } else {
            eligible.push(suggestion);
        }
    }

    eligible.sort(compareByImpact);
    delayed.sort(compareByImpact);

    return [...eligible, ...delayed];
}

function createBanTargetsMemo<T extends Suggestion>(source: Accessor<T[]>) {
    return createMemo(() => {
        const bestByRole = new Map<Role, T>();
        for (const suggestion of source()) {
            if (!bestByRole.has(suggestion.role)) {
                bestByRole.set(suggestion.role, suggestion);
            }
        }

        return ROLES.map((role) => ({
            role,
            suggestion: bestByRole.get(role),
        }));
    });
}

export function createDraftSuggestionsContext() {
    const { isLoaded, dataset, dataset30Days, getScopedDraftEngine } =
        useDataset();
    const { strategies } = useDraftStrategy();
    const {
        draftAnalysisConfig,
        allyTeamComp,
        opponentTeamComp,
        allyDataset,
        opponentDataset,
        allyDataset30Days,
        opponentDataset30Days,
    } = useDraftAnalysis();
    const { bans, allyTeam, opponentTeam } = useDraft();

    const countLocked = (team: typeof allyTeam) =>
        team.filter((pick) => Boolean(pick.championKey)).length;

    const allyStage = createMemo<DraftStage>(() => {
        const locked = countLocked(allyTeam);
        if (locked === 0) return "B1";
        if (locked <= 2) return "B2B3";
        if (locked <= 4) return "B4B5";
        return "B4B5";
    });

    const opponentStage = createMemo<DraftStage>(() => {
        const locked = countLocked(opponentTeam);
        if (locked <= 1) return "R1R2";
        if (locked === 2) return "R3";
        if (locked === 3) return "R4";
        return "R5";
    });

    const allySuggestions = createMemo(() => {
        if (!isLoaded()) return [];

        const strategyState = strategies();
        const currentDataset = allyDataset() ?? dataset();
        const historicalDataset = allyDataset30Days() ?? dataset30Days();
        const enemyDatasetValue = opponentDataset() ?? dataset();
        const enemyHistoricalDatasetValue =
            opponentDataset30Days() ?? dataset30Days();
        if (
            !currentDataset ||
            !historicalDataset ||
            !enemyDatasetValue ||
            !enemyHistoricalDatasetValue
        ) {
            return [];
        }
        const engine = getScopedDraftEngine(currentDataset);
        if (!engine) return [];
        const raw = getSuggestions(
            currentDataset,
            historicalDataset,
            allyTeamComp(),
            opponentTeamComp(),
            draftAnalysisConfig(),
            enemyDatasetValue,
            enemyHistoricalDatasetValue,
            { stage: allyStage(), engine }
        );

        const filtered = raw.filter(
            (suggestion) => !bans.includes(suggestion.championKey)
        );

        return applyStrategyWeight(
            filtered,
            strategyState.ally,
            opponentTeamComp()
        );
    });

    const opponentSuggestions = createMemo(() => {
        if (!isLoaded()) return [];

        const strategyState = strategies();
        const currentDataset = opponentDataset() ?? dataset();
        const historicalDataset =
            opponentDataset30Days() ?? dataset30Days();
        const enemyDatasetValue = allyDataset() ?? dataset();
        const enemyHistoricalDatasetValue =
            allyDataset30Days() ?? dataset30Days();
        if (
            !currentDataset ||
            !historicalDataset ||
            !enemyDatasetValue ||
            !enemyHistoricalDatasetValue
        ) {
            return [];
        }
        const engine = getScopedDraftEngine(currentDataset);
        if (!engine) return [];
        const raw = getSuggestions(
            currentDataset,
            historicalDataset,
            opponentTeamComp(),
            allyTeamComp(),
            draftAnalysisConfig(),
            enemyDatasetValue,
            enemyHistoricalDatasetValue,
            { stage: opponentStage(), engine }
        );

        const filtered = raw.filter(
            (suggestion) => !bans.includes(suggestion.championKey)
        );

        return applyStrategyWeight(
            filtered,
            strategyState.opponent,
            allyTeamComp()
        );
    });

    const allyBanTargets = createBanTargetsMemo(allySuggestions);
    const opponentBanTargets = createBanTargetsMemo(opponentSuggestions);

    return {
        allySuggestions,
        opponentSuggestions,
        allyBanTargets,
        opponentBanTargets,
    };
}

export const DraftSuggestionsContext =
    createContext<ReturnType<typeof createDraftSuggestionsContext>>();

export function DraftSuggestionsProvider(props: { children: JSXElement }) {
    return (
        <DraftSuggestionsContext.Provider
            value={createDraftSuggestionsContext()}
        >
            {props.children}
        </DraftSuggestionsContext.Provider>
    );
}

export function useDraftSuggestions() {
    const useCtx = useContext(DraftSuggestionsContext);
    if (!useCtx) throw new Error("No DraftSuggestionsContext found");

    return useCtx;
}
