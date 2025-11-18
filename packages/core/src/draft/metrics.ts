import { Role } from "../models/Role";

export type DraftRole = "top" | "jng" | "mid" | "bot" | "sup";

export const DRAFT_ROLES: DraftRole[] = ["top", "jng", "mid", "bot", "sup"];

export function roleIdToDraftRole(role: Role): DraftRole {
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
        default:
            return "top";
    }
}

export function draftRoleToRoleId(role: DraftRole): Role {
    switch (role) {
        case "top":
            return Role.Top;
        case "jng":
            return Role.Jungle;
        case "mid":
            return Role.Middle;
        case "bot":
            return Role.Bottom;
        case "sup":
            return Role.Support;
        default:
            return Role.Top;
    }
}

export interface MetricDistribution {
    mean: number;
    std: number;
}

export interface ChampionRoleMetrics {
    championKey: string;
    role: DraftRole;
    games: number;
    wins: number;
    minutes: number;

    winrateAdj: number;
    winrateZ: number;
    pickRate?: number;
    pickRateZ?: number;

    laneScores: {
        delta10: number;
        delta15: number;
        delta20: number;
        delta25: number;
        volatility: number;
    };

    prioZ: number;
    tfZ: number;
    scalZ: number;
    safetyZ: number;
    frontlineZ: number;
    exposureScore: number;

    intrinsic: number;
    blind: number;

    reliability: {
        relN: number;
        varianceLane: number;
        sigma: number;
    };

    flexPrior: number;
    flexScore?: number;

    componentBreakdown: {
        prio: number;
        teamfight: number;
        scaling: number;
        lane: number;
        safety: number;
        volatilityPenalty: number;
    };

    opponents: {
        championKey: string;
        probability: number;
        games: number;
    }[];
}

export interface ChampionFlexMetrics {
    championKey: string;
    entropy: number;
    practicalFlex: number;
    sampleSize: number;
    flexScore: number;
}

export interface SynergyEntry {
    championA: string;
    championB: string;
    samples: number;
    npmi: number;
    deltaWinrate: number;
    winrate: number;
    score: number;
}

export interface CounterEntry {
    role: DraftRole;
    champion: string;
    opponent: string;
    samples: number;
    wins: number;
    winrate: number;
    laneScore: number;
    laneDelta: number;
    kpEarly: number;
    score: number;
}

export interface PlayerChampionReliability {
    playerName: string;
    championKey: string;
    role: DraftRole;
    games: number;
    wins: number;
    relN: number;
    varianceLane: number;
    sigma: number;
    recentForm: number;
    reliabilityScore: number;
}

export interface CompositionHeuristicThresholds {
    frontline: number;
    prio: number;
}

export interface PrecomputedDraftMetrics {
    patch: string;
    generatedAt: string;
    sampleSize: number;

    roleWinrate: Record<DraftRole, number>;
    roleGames: Record<DraftRole, number>;

    championRoleMetrics: ChampionRoleMetrics[];
    championFlexMetrics: ChampionFlexMetrics[];
    synergyMatrix: SynergyEntry[];
    counterMatrix: CounterEntry[];
    playerReliability: PlayerChampionReliability[];

    weights: {
        intrinsic: {
            a: number;
            b: number;
            c: number;
            d: number;
            e: number;
        };
        blind: {
            w1: number;
            w2: number;
            w3: number;
            w4: number;
            w5: number;
        };
        flex: {
            u1: number;
            u2: number;
            u3: number;
        };
        reliability: {
            v1: number;
            v2: number;
            v3: number;
        };
        state: {
            k1: number;
            k2: number;
            k3: number;
            k4: number;
            k5: number;
            k6: number;
            k7: number;
        };
    };

    priors: {
        winrate: {
            n0: number;
        };
        continuous: {
            n0: number;
        };
    };

    exposureConfig: {
        counterThreshold: number;
    };

    composition: CompositionHeuristicThresholds;
}

type ChampionRoleKey = `${string}:${DraftRole}`;

export class DraftMetricsIndex {
    private readonly championRoleMap = new Map<ChampionRoleKey, ChampionRoleMetrics>();
    private readonly flexMap = new Map<string, ChampionFlexMetrics>();
    private readonly synergyMap = new Map<string, Map<string, SynergyEntry>>();
    private readonly counterMap = new Map<DraftRole, Map<string, Map<string, CounterEntry>>>();
    private readonly playerReliabilityMap = new Map<string, Map<string, Map<DraftRole, PlayerChampionReliability>>>();

    constructor(public readonly data: PrecomputedDraftMetrics) {
        for (const entry of data.championRoleMetrics) {
            this.championRoleMap.set(this.makeChampionRoleKey(entry.championKey, entry.role), entry);
        }
        for (const entry of data.championFlexMetrics) {
            this.flexMap.set(entry.championKey, entry);
        }
        for (const entry of data.synergyMatrix) {
            const [a, b] = [entry.championA, entry.championB];
            if (!this.synergyMap.has(a)) {
                this.synergyMap.set(a, new Map());
            }
            this.synergyMap.get(a)!.set(b, entry);
            if (!this.synergyMap.has(b)) {
                this.synergyMap.set(b, new Map());
            }
            this.synergyMap.get(b)!.set(a, entry);
        }
        for (const entry of data.counterMatrix) {
            if (!this.counterMap.has(entry.role)) {
                this.counterMap.set(entry.role, new Map());
            }
            const roleMap = this.counterMap.get(entry.role)!;
            if (!roleMap.has(entry.champion)) {
                roleMap.set(entry.champion, new Map());
            }
            roleMap.get(entry.champion)!.set(entry.opponent, entry);
        }
        for (const entry of data.playerReliability) {
            if (!this.playerReliabilityMap.has(entry.playerName)) {
                this.playerReliabilityMap.set(entry.playerName, new Map());
            }
            const playerMap = this.playerReliabilityMap.get(entry.playerName)!;
            if (!playerMap.has(entry.championKey)) {
                playerMap.set(entry.championKey, new Map());
            }
            playerMap.get(entry.championKey)!.set(entry.role, entry);
        }
    }

    private makeChampionRoleKey(championKey: string, role: DraftRole): ChampionRoleKey {
        return `${championKey}:${role}`;
    }

    getChampionRoleMetrics(championKey: string, role: DraftRole) {
        return this.championRoleMap.get(this.makeChampionRoleKey(championKey, role));
    }

    getFlexMetrics(championKey: string) {
        return this.flexMap.get(championKey);
    }

    getSynergyScore(championA: string, championB: string) {
        return this.synergyMap.get(championA)?.get(championB);
    }

    getCounterEntry(role: DraftRole, champion: string, opponent: string) {
        return this.counterMap.get(role)?.get(champion)?.get(opponent);
    }

    getPlayerChampionReliability(
        playerName: string,
        championKey: string,
        role: DraftRole
    ) {
        return this.playerReliabilityMap
            .get(playerName)
            ?.get(championKey)
            ?.get(role);
    }
}

export function buildDraftMetricsIndex(
    data: PrecomputedDraftMetrics
): DraftMetricsIndex {
    return new DraftMetricsIndex(data);
}

export function normalizeDraftRole(role: string): DraftRole | undefined {
    const lower = role.toLowerCase();
    switch (lower) {
        case "top":
            return "top";
        case "jng":
        case "jungle":
            return "jng";
        case "mid":
        case "middle":
            return "mid";
        case "bot":
        case "bottom":
        case "adc":
        case "carry":
            return "bot";
        case "sup":
        case "support":
            return "sup";
        default:
            return undefined;
    }
}

export function allDraftRoles(): DraftRole[] {
    return [...DRAFT_ROLES];
}
