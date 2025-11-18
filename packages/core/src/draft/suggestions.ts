import { Role, ROLES } from "../models/Role";
import { Dataset } from "../models/dataset/Dataset";
import {
    DraftResult,
    AnalyzeDraftConfig,
    analyzeDraft,
} from "./analysis";
import { getStats } from "./utils";
import { ratingToWinrate } from "../rating/ratings";
import { ProHighlight } from "../models/dataset/ChampionRoleData";
import { DraftEngine } from "./engine";
import { DraftRole, roleIdToDraftRole, draftRoleToRoleId } from "./metrics";

export type SuggestionReasonType =
    | "synergy"
    | "counter"
    | "meta"
    | "performance"
    | "reliability"
    | "risk";

export type SuggestionReasonSeverity = "positive" | "negative" | "info";

export interface SuggestionReason {
    type: SuggestionReasonType;
    severity: SuggestionReasonSeverity;
    label: string;
    value?: number;
}

export interface SuggestionScores {
    global: number;
    synergy: number;
    counter: number;
    performance: number;
    meta: number;
    reliabilityPenalty: number;
}

export interface SuggestionSynergyRef {
    partnerRole: Role;
    partnerChampionKey: string;
    games: number;
    winrate: number;
    highlights: ProHighlight[];
}

export interface SuggestionMatchupRef {
    opponentRole: Role;
    opponentChampionKey: string;
    games: number;
    winrate: number;
    highlights: ProHighlight[];
}

export interface SuggestionThreatRef {
    opponentRole: Role;
    opponentChampionKey: string;
    games: number;
    winrate: number;
}

export interface Suggestion {
    championKey: string;
    role: Role;
    draftResult: DraftResult;
    scores: SuggestionScores;
    reasons: SuggestionReason[];
    mu: number;
    sigma: number;
    reliabilityWeight: number;
    utility: number;
    blindSafety: number;
    coverScore: number;
    flexScore: number;
    trendScore: number;
    urgency: number;
    comfortScore: number;
    counterRisk: number;
    baseWinrate: number;
    sampleSize: number;
    pickRate: number;
    reliability: number;
    blindPickScore: number;
    teamWinrateAfter: number;
    teamWinrateDelta: number;
    teamRatingDelta: number;
    proSynergyRefs: SuggestionSynergyRef[];
    proMatchupRefs: SuggestionMatchupRef[];
    volumeScore: number;
    patternScore: number;
    banRecommendations?: SuggestionThreatRef[];
}

type RoleDistribution = {
    totals: Map<Role, number>;
    activeCounts: Map<Role, number>;
};

export type DraftStage =
    | "default"
    | "B1"
    | "B2B3"
    | "B4B5"
    | "R1R2"
    | "R3"
    | "R4"
    | "R5";

const PAIR_ROLE_LIMIT = 15;

type PairScoreWeights = {
    pickRate: number;
    synergy: number;
    flex: number;
    intrinsic: number;
    counter: number;
};

type StageScoreWeights = {
    pickRate?: number;
    blind?: number;
    flex?: number;
    intrinsic?: number;
    reliability?: number;
    exposure?: number;
    deny?: number;
    synergy?: number;
    counter?: number;
    universal?: number;
    pairWeights?: PairScoreWeights;
};

const STAGE_SCORE_WEIGHTS: Record<DraftStage | "default", StageScoreWeights> = {
    default: {
        synergy: 0.35,
        counter: 0.3,
        flex: 0.1,
        pickRate: 0.1,
        intrinsic: 0.05,
        reliability: 0.05,
        exposure: -0.05,
    },
    B1: {
        pickRate: 0.5,
        blind: 0.2,
        flex: 0.15,
        intrinsic: 0.1,
        reliability: 0.03,
        exposure: -0.02,
        deny: 0.02,
    },
    B2B3: {
        synergy: 0.35,
        counter: 0.25,
        flex: 0.1,
        pickRate: 0.03,
        intrinsic: 0.02,
        exposure: -0.05,
        pairWeights: { pickRate: 0, synergy: 0.25, flex: 0, intrinsic: 0, counter: 0 },
    },
    B4B5: {
        synergy: 0.45,
        counter: 0.35,
        flex: 0.1,
        pickRate: 0.05,
        reliability: 0.05,
        exposure: -0.05,
    },
    R1R2: {
        pickRate: 0.05,
        flex: 0.05,
        synergy: 0.1,
        exposure: -0.05,
        pairWeights: {
            pickRate: 0.35,
            synergy: 0.3,
            flex: 0.1,
            intrinsic: 0.1,
            counter: 0.15,
        },
    },
    R3: {
        counter: 0.45,
        synergy: 0.25,
        flex: 0.1,
        pickRate: 0.1,
        intrinsic: 0.05,
        reliability: 0.05,
        exposure: -0.05,
    },
    R4: {
        universal: 0.4,
        synergy: 0.3,
        counter: 0.15,
        pickRate: 0.1,
        flex: 0.05,
        exposure: -0.05,
    },
    R5: {
        counter: 0.55,
        synergy: 0.2,
        reliability: 0.1,
        flex: 0.1,
        pickRate: 0.05,
        exposure: -0.05,
    },
};

export interface SuggestionOptions {
    stage?: DraftStage;
    engine?: DraftEngine;
}

type StagePairResult = {
    score: number;
    partner?: string;
    partnerRole?: Role;
};

type CandidateEvaluation = {
    championKey: string;
    role: Role;
    draftRole: DraftRole;
    pickRateZ: number;
    blind: number;
    intrinsic: number;
    flexScore: number;
    flexPrior: number;
    reliability: number;
    exposure: number;
    synergyAverage: number;
    synergyMax: number;
    enemySynergyAverage: number;
    counterAverage: number;
    universalScore: number;
    denyScore: number;
    sampleSize: number;
    wins: number;
    baseWinrate: number;
    pickRate: number;
    mu: number;
    sigma: number;
    reliabilityWeight: number;
    teamWinrateAfter: number;
    teamWinrateDelta: number;
    teamRatingDelta: number;
    draftResult: DraftResult;
    stats: ReturnType<typeof getStats>;
    fallbackStats: ReturnType<typeof getStats>;
    volumeScore: number;
    trendScore: number;
    counterRisk: number;
    bestPairs: Map<DraftStage, StagePairResult>;
    stageScore: number;
    topPairPartner?: StagePairResult & { championKey?: string };
};

function computeRoleDistribution(dataset: Dataset): RoleDistribution {
    const totals = new Map<Role, number>();
    const activeCounts = new Map<Role, number>();

    for (const champion of Object.values(dataset.championData)) {
        for (const role of ROLES) {
            const games = champion.statsByRole?.[role]?.games ?? 0;
            if (!Number.isFinite(games) || games <= 0) continue;

            totals.set(role, (totals.get(role) ?? 0) + games);
            activeCounts.set(role, (activeCounts.get(role) ?? 0) + 1);
        }
    }

    return { totals, activeCounts };
}

function clamp(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function winrateDeltaFromRating(rating: number) {
    return ratingToWinrate(rating) - 0.5;
}

function jeffreysMean(wins: number, games: number) {
    return (wins + 0.5) / (games + 1);
}

function wilsonHalfWidth(wins: number, games: number, z = 1.64) {
    if (!Number.isFinite(games) || games <= 0) {
        return 0.08;
    }
    const pHat = clamp(wins / games, 0, 1);
    const z2 = z * z;
    const denom = 1 + z2 / games;
    const half =
        (z * Math.sqrt((pHat * (1 - pHat)) / games + z2 / (4 * games * games))) /
        denom;
    return Math.max(0, Math.min(0.5, Math.abs(half)));
}

function saturate(value: number, k: number) {
    if (!Number.isFinite(value) || !Number.isFinite(k) || k <= 0) return 0;
    return Math.tanh(value / k);
}

function logistic(value: number, slope = 1) {
    if (!Number.isFinite(value)) return 0.5;
    if (!Number.isFinite(slope) || slope === 0) {
        slope = 1;
    }
    return 1 / (1 + Math.exp(-value / slope));
}

function sumDuoImpact(
    draftResult: DraftResult,
    championKey: string,
    role: Role
) {
    return draftResult.allyDuoRating.duoResults.reduce((total, duo) => {
        if (
            (duo.championKeyA === championKey && duo.roleA === role) ||
            (duo.championKeyB === championKey && duo.roleB === role)
        ) {
            return total + duo.rating;
        }
        return total;
    }, 0);
}

function sumMatchupImpact(
    draftResult: DraftResult,
    championKey: string,
    role: Role
) {
    return draftResult.matchupRating.matchupResults.reduce((total, matchup) => {
        if (matchup.championKeyA === championKey && matchup.roleA === role) {
            return total + matchup.rating;
        }
        return total;
    }, 0);
}

const PRIORITY_DUO_ROLES: Array<[Role, Role]> = [
    [0, 1],
    [1, 2],
    [3, 4],
    [1, 4],
    [0, 2],
];

const BASE_SIGMA = 0.02;
const MODEL_SIGMA = 0.015;
const FLEX_MIN_GAMES = 40;

function computeTrendScore(
    currentWins: number,
    currentGames: number,
    longWins: number,
    longGames: number
) {
    const current = jeffreysMean(currentWins, currentGames);
    const baseline = jeffreysMean(longWins, longGames);
    const diff = current - baseline;
    return saturate(diff, 0.03);
}

function computeReliabilityWeight(sigma: number) {
    if (!Number.isFinite(sigma) || sigma <= 0) return 0;
    return 1 / (1 + (sigma / BASE_SIGMA) ** 2);
}

function isPriorityDuo(roleA: Role, roleB: Role) {
    return PRIORITY_DUO_ROLES.some(
        ([a, b]) =>
            (a === roleA && b === roleB) || (a === roleB && b === roleA)
    );
}

function getTopSynergyRefs(
    dataset: Dataset,
    championKey: string,
    role: Role,
    team?: Map<Role, string>,
    limit = 3
): SuggestionSynergyRef[] {
    const championData = dataset.championData[championKey];
    if (!championData) return [];
    const roleData = championData.statsByRole[role];
    if (!roleData) return [];

    const collect = (filterTeam?: Map<Role, string>) => {
        const entries: SuggestionSynergyRef[] = [];
        const allowed = filterTeam
            ? new Set(
                  [...filterTeam.entries()]
                      .filter(
                          ([allyRole, allyChampionKey]) =>
                              !(allyRole === role && allyChampionKey === championKey)
                      )
                      .map(
                          ([allyRole, allyChampionKey]) =>
                              `${allyRole}:${allyChampionKey}`
                      )
              )
            : undefined;

        for (const partnerRoleKey of ROLES) {
            if (!isPriorityDuo(role, partnerRoleKey)) continue;
            const partnerStats = roleData.synergy[partnerRoleKey];
            if (!partnerStats) continue;
            for (const [partnerChampionKey, stats] of Object.entries(
                partnerStats ?? {}
            )) {
                if (!stats || stats.games < 5) continue;
                if (
                    allowed &&
                    !allowed.has(`${partnerRoleKey}:${partnerChampionKey}`)
                ) {
                    continue;
                }
                const highlights =
                    roleData.highlights?.synergy?.[partnerRoleKey]?.[
                        partnerChampionKey
                    ] ?? [];
                entries.push({
                    partnerRole: partnerRoleKey,
                    partnerChampionKey,
                    games: stats.games,
                    winrate:
                        stats.games > 0
                            ? clamp(stats.wins / stats.games, 0, 1)
                            : 0.5,
                    highlights,
                });
            }
        }

        return entries;
    };

    let entries = collect(team);
    if (!entries.length) {
        entries = collect();
    }

    return entries
        .sort((a, b) => {
            if (b.games !== a.games) return b.games - a.games;
            return b.winrate - a.winrate;
        })
        .slice(0, limit);
}

function getTopMatchupRefs(
    dataset: Dataset,
    championKey: string,
    role: Role,
    opponentTeam?: Map<Role, string>,
    limit = 3
): SuggestionMatchupRef[] {
    const championData = dataset.championData[championKey];
    if (!championData) return [];
    const roleData = championData.statsByRole[role];
    if (!roleData) return [];

    const collect = (filterTeam?: Map<Role, string>) => {
        const entries: SuggestionMatchupRef[] = [];
        const allowed = filterTeam
            ? new Set(
                  [...filterTeam.entries()].map(
                      ([opponentRole, opponentChampionKey]) =>
                          `${opponentRole}:${opponentChampionKey}`
                  )
              )
            : undefined;

        for (const opponentRoleKey of ROLES) {
            const matchupStats = roleData.matchup[opponentRoleKey];
            if (!matchupStats) continue;
            for (const [opponentChampionKey, stats] of Object.entries(
                matchupStats ?? {}
            )) {
                if (!stats || stats.games < 5) continue;
                if (
                    allowed &&
                    !allowed.has(`${opponentRoleKey}:${opponentChampionKey}`)
                ) {
                    continue;
                }
                const highlights =
                    roleData.highlights?.matchup?.[opponentRoleKey]?.[
                        opponentChampionKey
                    ] ?? [];
                const winrate =
                    stats.games > 0
                        ? clamp(stats.wins / stats.games, 0, 1)
                        : 0.5;
                entries.push({
                    opponentRole: opponentRoleKey,
                    opponentChampionKey,
                    games: stats.games,
                    winrate,
                    highlights,
                });
            }
        }

        return entries;
    };

    let entries = collect(opponentTeam);
    if (!entries.length) {
        entries = collect();
    }

    return entries
        .sort((a, b) => {
            if (b.winrate !== a.winrate) return b.winrate - a.winrate;
            return b.games - a.games;
        })
        .slice(0, limit);
}

function getTopThreatRecommendations(
    dataset: Dataset,
    championKey: string,
    role: Role,
    limit = 2
): SuggestionThreatRef[] {
    const championData = dataset.championData[championKey];
    if (!championData) return [];
    const roleData = championData.statsByRole[role];
    if (!roleData) return [];

    const entries: SuggestionThreatRef[] = [];

    for (const opponentRoleKey of ROLES) {
        const matchupStats = roleData.matchup[opponentRoleKey];
        if (!matchupStats) continue;
        for (const [opponentChampionKey, stats] of Object.entries(
            matchupStats ?? {}
        )) {
            if (!stats || stats.games < 6) continue;
            const candidateWinrate =
                stats.games > 0 ? clamp(stats.wins / stats.games, 0, 1) : 0.5;
            const opponentWinrate = 1 - candidateWinrate;
            const advantage = opponentWinrate - 0.5;
            if (advantage < 0.04) continue;
            entries.push({
                opponentRole: opponentRoleKey,
                opponentChampionKey,
                games: stats.games,
                winrate: opponentWinrate,
            });
        }
    }

    return entries
        .sort((a, b) => {
            if (b.winrate !== a.winrate) return b.winrate - a.winrate;
            return b.games - a.games;
        })
        .slice(0, limit);
}

export function getSuggestions(
    dataset: Dataset,
    synergyMatchupDataset: Dataset,
    team: Map<Role, string>,
    enemy: Map<Role, string>,
    config: AnalyzeDraftConfig,
    enemyDataset?: Dataset,
    enemySynergyMatchupDataset?: Dataset,
    options: SuggestionOptions = {}
) {
    const stage = (options.stage ?? "default") as DraftStage | "default";
    const stageWeights =
        STAGE_SCORE_WEIGHTS[stage] ?? STAGE_SCORE_WEIGHTS.default;
    const engine = options.engine;
    if (!engine) {
        console.warn("getSuggestions requires a draft engine instance");
        return [];
    }

    const remainingRoles = ROLES.filter((role) => !team.has(role));
    if (!remainingRoles.length) {
        return [];
    }

    const enemyChampions = new Set(enemy.values());
    const allyChampions = new Set(team.values());
    const roleDistribution = computeRoleDistribution(synergyMatchupDataset);
    const scopedEnemyDataset = enemyDataset ?? dataset;
    const scopedEnemySynergyDataset =
        enemySynergyMatchupDataset ?? synergyMatchupDataset;

    const baselineResult = analyzeDraft(
        dataset,
        synergyMatchupDataset,
        team,
        enemy,
        config,
        scopedEnemyDataset,
        scopedEnemySynergyDataset
    );
    const baselineWinrate = baselineResult.winrate;

    const candidates: CandidateEvaluation[] = [];

    for (const championKey of Object.keys(dataset.championData)) {
        if (enemyChampions.has(championKey) || allyChampions.has(championKey)) {
            continue;
        }

        for (const role of remainingRoles) {
            const evaluation = evaluateCandidate(
                championKey,
                role,
                dataset,
                synergyMatchupDataset,
                team,
                enemy,
                config,
                scopedEnemyDataset,
                scopedEnemySynergyDataset,
                baselineResult,
                baselineWinrate,
                roleDistribution,
                engine
            );
            if (evaluation) {
                candidates.push(evaluation);
            }
        }
    }

    if (!candidates.length) {
        return [];
    }

    if (stageWeights.pairWeights && stage !== "default") {
        computePairBoosts(
            candidates,
            stage as DraftStage,
            stageWeights.pairWeights,
            engine
        );
    }

    for (const candidate of candidates) {
        candidate.stageScore = computeStageScore(stage, candidate, stageWeights);
    }

    return candidates
        .map((candidate) =>
            buildSuggestion(
                candidate,
                stage,
                stageWeights,
                dataset,
                synergyMatchupDataset,
                team,
                enemy,
                engine
            )
        )
        .sort((a, b) => {
            if (b.scores.global !== a.scores.global) {
                return b.scores.global - a.scores.global;
            }
            if (b.scores.synergy !== a.scores.synergy) {
                return b.scores.synergy - a.scores.synergy;
            }
            return b.pickRate - a.pickRate;
        });
}

function evaluateCandidate(
    championKey: string,
    role: Role,
    dataset: Dataset,
    synergyMatchupDataset: Dataset,
    team: Map<Role, string>,
    enemy: Map<Role, string>,
    config: AnalyzeDraftConfig,
    scopedEnemyDataset: Dataset,
    scopedEnemySynergyDataset: Dataset,
    baselineResult: DraftResult,
    baselineWinrate: number,
    roleDistribution: RoleDistribution,
    engine: DraftEngine
): CandidateEvaluation | undefined {
    const draftRole = roleIdToDraftRole(role);
    const roleMetrics = engine.index.getChampionRoleMetrics(
        championKey,
        draftRole
    );
    if (!roleMetrics) {
        return undefined;
    }

    const currentStats = getStats(dataset, championKey, role);
    const fallbackStats = getStats(synergyMatchupDataset, championKey, role);
    const stats =
        currentStats.games >= fallbackStats.games ? currentStats : fallbackStats;

    const teamWithCandidate = new Map(team);
    teamWithCandidate.set(role, championKey);

    const draftResult = analyzeDraft(
        dataset,
        synergyMatchupDataset,
        teamWithCandidate,
        enemy,
        config,
        scopedEnemyDataset,
        scopedEnemySynergyDataset
    );

    const teamWinrateAfter = draftResult.winrate;
    const teamWinrateDelta = teamWinrateAfter - baselineWinrate;
    const teamRatingDelta = draftResult.totalRating - baselineResult.totalRating;

    const sigmaData = wilsonHalfWidth(stats.wins, stats.games);
    const sigma = Math.sqrt(sigmaData * sigmaData + MODEL_SIGMA * MODEL_SIGMA);
    const reliabilityWeight = clamp(computeReliabilityWeight(sigma), 0, 1);
    const reliabilityMetric = roleMetrics.reliability?.relN ?? reliabilityWeight;

    const totalRoleGames = roleDistribution.totals.get(role) ?? 0;
    const pickRate =
        totalRoleGames > 0 ? stats.games / totalRoleGames : 0;

    const baseWinrate =
        stats.games > 0 ? clamp(stats.wins / stats.games, 0, 1) : 0.5;

    let synergySum = 0;
    let synergyMax = 0;
    let synergyCount = 0;
    for (const [, allyChampionKey] of team.entries()) {
        if (!allyChampionKey) continue;
        const entry = engine.index.getSynergyScore(championKey, allyChampionKey);
        if (!entry) continue;
        synergySum += entry.score;
        synergyMax = Math.max(synergyMax, entry.score);
        synergyCount += 1;
    }
    const synergyAverage = synergyCount ? synergySum / synergyCount : 0;

    let enemySynergySum = 0;
    let enemySynergyCount = 0;
    for (const [, enemyChampionKey] of enemy.entries()) {
        if (!enemyChampionKey) continue;
        const entry = engine.index.getSynergyScore(championKey, enemyChampionKey);
        if (!entry) continue;
        enemySynergySum += entry.score;
        enemySynergyCount += 1;
    }
    const enemySynergyAverage =
        enemySynergyCount ? enemySynergySum / enemySynergyCount : 0;

    let counterSum = 0;
    let counterCount = 0;
    for (const [, enemyChampionKey] of enemy.entries()) {
        if (!enemyChampionKey) continue;
        const entry = engine.index.getCounterEntry(
            draftRole,
            championKey,
            enemyChampionKey
        );
        if (!entry) continue;
        counterSum += entry.score;
        counterCount += 1;
    }
    const counterAverage = counterCount ? counterSum / counterCount : 0;

    const trendScore = computeTrendScore(
        currentStats.wins,
        currentStats.games,
        fallbackStats.wins,
        fallbackStats.games
    );

    return {
        championKey,
        role,
        draftRole,
        pickRateZ: roleMetrics.pickRateZ ?? 0,
        blind: roleMetrics.blind ?? 0,
        intrinsic: roleMetrics.intrinsic ?? 0,
        flexScore: roleMetrics.flexScore ?? roleMetrics.flexPrior ?? 0,
        flexPrior: roleMetrics.flexPrior ?? 0,
        reliability: reliabilityMetric,
        exposure: roleMetrics.exposureScore ?? 0,
        synergyAverage,
        synergyMax,
        enemySynergyAverage,
        counterAverage,
        universalScore: synergyAverage - (roleMetrics.exposureScore ?? 0),
        denyScore: enemySynergyAverage,
        sampleSize: stats.games,
        wins: stats.wins,
        baseWinrate,
        pickRate,
        mu: teamWinrateDelta,
        sigma,
        reliabilityWeight,
        teamWinrateAfter,
        teamWinrateDelta,
        teamRatingDelta,
        draftResult,
        stats,
        fallbackStats,
        volumeScore: Math.log1p(stats.games),
        trendScore,
        counterRisk: Math.max(0, roleMetrics.exposureScore ?? 0),
        bestPairs: new Map(),
        stageScore: 0,
    };
}

function computePairBoosts(
    candidates: CandidateEvaluation[],
    stage: DraftStage,
    weights: PairScoreWeights,
    engine: DraftEngine
) {
    const candidatesByRole = new Map<Role, CandidateEvaluation[]>();
    for (const candidate of candidates) {
        const list = candidatesByRole.get(candidate.role);
        if (list) {
            list.push(candidate);
        } else {
            candidatesByRole.set(candidate.role, [candidate]);
        }
    }

    for (const list of candidatesByRole.values()) {
        list.sort((a, b) => b.pickRateZ - a.pickRateZ);
    }

    for (const candidate of candidates) {
        let best: StagePairResult | undefined;

        for (const [role, list] of candidatesByRole.entries()) {
            if (role === candidate.role) continue;
            let tested = 0;
            for (const partner of list) {
                if (partner.championKey === candidate.championKey) continue;
                const score = evaluatePair(weights, candidate, partner, engine);
                if (!best || score > best.score) {
                    best = {
                        score,
                        partner: partner.championKey,
                        partnerRole: partner.role,
                    };
                }
                tested += 1;
                if (tested >= PAIR_ROLE_LIMIT) break;
            }
        }

        if (best) {
            candidate.bestPairs.set(stage, best);
        }
    }
}

function evaluatePair(
    weights: PairScoreWeights,
    a: CandidateEvaluation,
    b: CandidateEvaluation,
    engine: DraftEngine
) {
    const synergyEntry = engine.index.getSynergyScore(
        a.championKey,
        b.championKey
    );
    const pairSynergy = synergyEntry?.score ?? 0;
    return (
        weights.pickRate * (a.pickRateZ + b.pickRateZ) +
        weights.synergy * pairSynergy +
        weights.flex * (a.flexScore + b.flexScore) +
        weights.intrinsic * (a.intrinsic + b.intrinsic) +
        weights.counter * (a.counterAverage + b.counterAverage)
    );
}

function computeStageScore(
    stage: DraftStage | "default",
    candidate: CandidateEvaluation,
    weights: StageScoreWeights
) {
    let score = 0;
    if (weights.pickRate) score += weights.pickRate * candidate.pickRateZ;
    if (weights.blind) score += weights.blind * candidate.blind;
    if (weights.flex) score += weights.flex * candidate.flexScore;
    if (weights.intrinsic) score += weights.intrinsic * candidate.intrinsic;
    if (weights.reliability) score += weights.reliability * candidate.reliability;
    if (weights.exposure) score += weights.exposure * candidate.exposure;
    if (weights.deny) score += weights.deny * candidate.denyScore;
    if (weights.synergy) score += weights.synergy * candidate.synergyAverage;
    if (weights.counter) score += weights.counter * candidate.counterAverage;
    if (weights.universal) score += weights.universal * candidate.universalScore;

    if (weights.pairWeights && stage !== "default") {
        const pair = candidate.bestPairs.get(stage as DraftStage);
        if (pair) {
            score += pair.score;
            candidate.topPairPartner = { ...pair };
        }
    }

    return score;
}

function buildSuggestion(
    candidate: CandidateEvaluation,
    stage: DraftStage | "default",
    weights: StageScoreWeights,
    dataset: Dataset,
    synergyDataset: Dataset,
    team: Map<Role, string>,
    enemy: Map<Role, string>,
    engine: DraftEngine
): Suggestion {
    const scores: SuggestionScores = {
        global: candidate.stageScore,
        synergy: candidate.synergyAverage,
        counter: candidate.counterAverage,
        performance: candidate.intrinsic,
        meta: candidate.pickRateZ,
        reliabilityPenalty: 1 - candidate.reliability,
    };

    const reasons = buildStageReasons(candidate, stage, dataset);

    const blindSafety = clamp(candidate.blind - candidate.exposure, -3, 3);
    const blindPickScore = Math.max(0, blindSafety) * 100;

    const proSynergyRefs = getTopSynergyRefs(
        synergyDataset,
        candidate.championKey,
        candidate.role,
        team
    );
    const proMatchupRefs = getTopMatchupRefs(
        synergyDataset,
        candidate.championKey,
        candidate.role,
        enemy
    );

    const banRecommendations =
        stage === "R3" ? buildBanRecommendations(candidate, engine) : undefined;

    return {
        championKey: candidate.championKey,
        role: candidate.role,
        draftResult: candidate.draftResult,
        scores,
        reasons,
        mu: candidate.mu,
        sigma: candidate.sigma,
        reliabilityWeight: candidate.reliabilityWeight,
        utility: candidate.stageScore,
        blindSafety,
        coverScore: candidate.synergyAverage - candidate.exposure,
        flexScore: candidate.flexScore,
        trendScore: candidate.trendScore,
        urgency: Math.max(0, candidate.pickRateZ),
        comfortScore: 0,
        counterRisk: candidate.counterRisk,
        baseWinrate: candidate.baseWinrate,
        sampleSize: candidate.sampleSize,
        pickRate: candidate.pickRate,
        reliability: candidate.reliability,
        blindPickScore,
        teamWinrateAfter: candidate.teamWinrateAfter,
        teamWinrateDelta: candidate.teamWinrateDelta,
        teamRatingDelta: candidate.teamRatingDelta,
        proSynergyRefs,
        proMatchupRefs,
        volumeScore: candidate.volumeScore,
        patternScore: candidate.topPairPartner?.score ?? 0,
        banRecommendations: banRecommendations?.length ? banRecommendations : undefined,
    };
}

function buildStageReasons(
    candidate: CandidateEvaluation,
    stage: DraftStage | "default",
    dataset: Dataset
) {
    const reasons: SuggestionReason[] = [];

    if (candidate.sampleSize === 0) {
        reasons.push({
            type: "reliability",
            severity: "info",
            label: "Aucune donnee pro sur ce patch",
            value: 0,
        });
    }

    if (candidate.synergyAverage >= 0.4) {
        reasons.push({
            type: "synergy",
            severity: "positive",
            label: "Synergie forte",
            value: candidate.synergyAverage,
        });
    } else if (candidate.synergyAverage <= -0.3) {
        reasons.push({
            type: "synergy",
            severity: "negative",
            label: "Peu de synergie",
            value: candidate.synergyAverage,
        });
    }

    if (candidate.counterAverage >= 0.4) {
        reasons.push({
            type: "counter",
            severity: "positive",
            label: "Excellent contre",
            value: candidate.counterAverage,
        });
    } else if (candidate.counterAverage <= -0.3) {
        reasons.push({
            type: "counter",
            severity: "negative",
            label: "Matchup delicat",
            value: candidate.counterAverage,
        });
    }

    if (candidate.pickRateZ >= 1) {
        reasons.push({
            type: "meta",
            severity: "positive",
            label: "Tres conteste dans la meta",
            value: candidate.pickRateZ,
        });
    } else if (candidate.pickRateZ <= -1) {
        reasons.push({
            type: "meta",
            severity: "info",
            label: "Pick surprise (faible popularite)",
            value: candidate.pickRateZ,
        });
    }

    if (candidate.reliability >= 0.6) {
        reasons.push({
            type: "reliability",
            severity: "positive",
            label: "Donnees fiables",
            value: candidate.reliability,
        });
    } else if (candidate.reliability <= 0.3) {
        reasons.push({
            type: "reliability",
            severity: "negative",
            label: "Petit echantillon",
            value: candidate.reliability,
        });
    }

    if (candidate.exposure >= 0.6) {
        reasons.push({
            type: "risk",
            severity: "negative",
            label: "Exposition aux counters",
            value: candidate.exposure,
        });
    }

    if (stage === "B1" && candidate.denyScore >= 0.3) {
        reasons.push({
            type: "risk",
            severity: "info",
            label: "Deny de combo adverse",
            value: candidate.denyScore,
        });
    }

    if (
        candidate.topPairPartner?.partner &&
        (stage === "R1R2" || stage === "B2B3")
    ) {
        const partnerName = lookupChampionName(
            dataset,
            candidate.topPairPartner.partner
        );
        reasons.push({
            type: "synergy",
            severity: "positive",
            label: `Combo avec ${partnerName}`,
            value: candidate.topPairPartner.score,
        });
    }

    return reasons;
}

function buildBanRecommendations(
    candidate: CandidateEvaluation,
    engine: DraftEngine
) {
    const entries = engine.data.counterMatrix
        .filter(
            (entry) =>
                entry.role === candidate.draftRole &&
                entry.champion === candidate.championKey
        )
        .sort((a, b) => a.score - b.score)
        .slice(0, 2)
        .map((entry) => ({
            opponentRole: draftRoleToRoleId(entry.role),
            opponentChampionKey: entry.opponent,
            games: entry.samples,
            winrate: clamp(entry.winrate ?? 0.5, 0, 1),
        }));
    return entries;
}

function lookupChampionName(dataset: Dataset, championKey: string) {
    return dataset.championData[championKey]?.name ?? championKey;
}



