import {
    DraftMetricsIndex,
    DraftRole,
    PrecomputedDraftMetrics,
    buildDraftMetricsIndex,
    draftRoleToRoleId,
    roleIdToDraftRole,
} from "./metrics";
import { Role, ROLES } from "../models/Role";
import {
    getCounterRoleWeight,
    getSynergyRoleWeight,
} from "./role-weights";
import { safeDivide } from "./math";

export interface DraftPickDescriptor {
    role: Role;
    championKey: string;
    playerName?: string;
}

export interface DraftTeamState {
    picks: DraftPickDescriptor[];
}

export interface DraftEvaluationPick {
    championKey: string;
    role: Role;
    draftRole: DraftRole;
    intrinsic: number;
    blind: number;
    flex: number;
    reliability: number;
    synergy: number;
    counter: number;
    exposure: number;
    deny: number;
    total: number;
}

export interface DraftEvaluation {
    totalScore: number;
    individualScore: number;
    synergyScore: number;
    counterScore: number;
    exposurePenalty: number;
    compositionScore: number;
    riskScore: number;
    compositionNotes: string[];
    picks: DraftEvaluationPick[];
    notes: string[];
}

export interface DraftCandidateScore {
    pick: DraftEvaluationPick;
    // Net change in totalScore (engine weights) when adding this pick.
    draftScore: number;
}

export interface DraftEngineOptions {
    weights?: Partial<PrecomputedDraftMetrics["weights"]["state"]>;
}

export interface DraftEngine {
    data: PrecomputedDraftMetrics;
    index: DraftMetricsIndex;
    weights: PrecomputedDraftMetrics["weights"]["state"];
}

export function createDraftEngine(
    metrics: PrecomputedDraftMetrics,
    options: DraftEngineOptions = {}
): DraftEngine {
    const weights = { ...metrics.weights.state, ...(options.weights ?? {}) };
    return {
        data: metrics,
        index: buildDraftMetricsIndex(metrics),
        weights,
    };
}

type InternalPickContext = {
    pick: DraftPickDescriptor;
    draftRole: DraftRole;
    metrics:
        | ReturnType<DraftMetricsIndex["getChampionRoleMetrics"]>
        | undefined;
    flexMetrics:
        | ReturnType<DraftMetricsIndex["getFlexMetrics"]>
        | undefined;
    playerReliability?: ReturnType<
        DraftMetricsIndex["getPlayerChampionReliability"]
    >;
    synergy: number;
    counter: number;
    deny: number;
    exposure: number;
    reliability: number;
};

type CompositionEvaluation = {
    bonus: number;
    penalty: number;
    notes: string[];
};

function average(values: number[]) {
    if (!values.length) return 0;
    const sum = values.reduce((acc, value) => acc + value, 0);
    return sum / values.length;
}

function evaluateComposition(contexts: InternalPickContext[]): CompositionEvaluation {
    const metricsList = contexts
        .map((ctx) => ctx.metrics)
        .filter((metric): metric is NonNullable<typeof metric> => Boolean(metric));

    if (!metricsList.length) {
        return { bonus: 0, penalty: 0, notes: [] };
    }

    let bonus = 0;
    let penalty = 0;
    const notes: string[] = [];

    const frontlineMax = Math.max(...metricsList.map((m) => m.frontlineZ ?? 0));
    if (frontlineMax < -0.2) {
        penalty += 0.4;
        notes.push("Frontline fragile");
    } else if (frontlineMax > 0.6) {
        bonus += 0.2;
        notes.push("Frontline solide");
    }

    const prioAvg = average(
        metricsList.map((m) => m.componentBreakdown.prio ?? 0)
    );
    if (prioAvg < -0.2) {
        penalty += 0.3;
        notes.push("Waveclear limite");
    } else if (prioAvg > 0.2) {
        bonus += 0.15;
        notes.push("Bonne pression de lane");
    }

    const scalingAvg = average(
        metricsList.map((m) => m.componentBreakdown.scaling ?? 0)
    );
    if (scalingAvg < -0.25) {
        penalty += 0.2;
        notes.push("Scaling faible");
    } else if (scalingAvg > 0.25) {
        bonus += 0.15;
        notes.push("Scaling solide");
    }

    const laneAvg = average(
        metricsList.map((m) => m.componentBreakdown.lane ?? 0)
    );
    if (laneAvg < -0.3) {
        penalty += 0.2;
        notes.push("Phase de lane fragile");
    }

    const teamfightAvg = average(
        metricsList.map((m) => m.componentBreakdown.teamfight ?? 0)
    );
    if (teamfightAvg < -0.2) {
        penalty += 0.2;
        notes.push("Peu d'impact en teamfight");
    } else if (teamfightAvg > 0.25) {
        bonus += 0.15;
        notes.push("Teamfight puissant");
    }

    const safetyAvg = average(
        metricsList.map((m) => m.componentBreakdown.safety ?? 0)
    );
    if (safetyAvg < -0.2) {
        penalty += 0.1;
        notes.push("Draft peu stable (blind)");
    }

    return {
        bonus,
        penalty,
        notes,
    };
}

function normaliseTeam(state: Map<Role, string>): DraftTeamState {
    const picks: DraftPickDescriptor[] = [];
    for (const role of ROLES) {
        const championKey = state.get(role);
        if (!championKey) continue;
        picks.push({ role, championKey });
    }
    return { picks };
}

export function evaluateDraft(
    engine: DraftEngine,
    teamMap: Map<Role, string>,
    enemyMap: Map<Role, string>,
    playerAssignments?: Map<Role, string>
): DraftEvaluation {
    const team = normaliseTeam(teamMap);
    const enemy = normaliseTeam(enemyMap);

    const pickContexts: InternalPickContext[] = team.picks.map((pick) => {
        const draftRole = roleIdToDraftRole(pick.role);
        const metrics = engine.index.getChampionRoleMetrics(
            pick.championKey,
            draftRole
        );
        const flexMetrics = engine.index.getFlexMetrics(pick.championKey);
        const playerName = playerAssignments?.get(pick.role);
        const playerReliability = playerName
            ? engine.index.getPlayerChampionReliability(
                  playerName,
                  pick.championKey,
                  draftRole
              )
            : undefined;
        return {
            pick,
            draftRole,
            metrics,
            flexMetrics,
            playerReliability,
            synergy: 0,
            counter: 0,
            deny: 0,
            exposure: metrics?.exposureScore ?? 0,
            reliability:
                playerReliability?.reliabilityScore ??
                metrics?.reliability.relN ??
                0,
        };
    });

    const SYNERGY_SCALE = 1;
    const COUNTER_SCALE = 1;

    const synergyTotals = new Array<number>(pickContexts.length).fill(0);
    const synergyPairs: Array<{
        index: number;
        score: number;
        weight: number;
    }> = [];

    for (let i = 0; i < pickContexts.length; i++) {
        for (let j = i + 1; j < pickContexts.length; j++) {
            const a = pickContexts[i];
            const b = pickContexts[j];
            if (!a.metrics || !b.metrics) continue;
            const entry = engine.index.getSynergyScore(
                a.pick.championKey,
                b.pick.championKey
            );
            if (!entry) continue;
            const score = Number.isFinite(entry.npmi) ? entry.npmi : entry.score;
            if (!Number.isFinite(score) || score === 0) continue;

            const weightAB = getSynergyRoleWeight(a.pick.role, b.pick.role);
            if (weightAB > 0) {
                synergyPairs.push({ index: i, score, weight: weightAB });
                synergyTotals[i] += weightAB;
            }
            const weightBA = getSynergyRoleWeight(b.pick.role, a.pick.role);
            if (weightBA > 0) {
                synergyPairs.push({ index: j, score, weight: weightBA });
                synergyTotals[j] += weightBA;
            }
        }
    }

    let synergyTotal = 0;
    for (const pair of synergyPairs) {
        const totalWeight = synergyTotals[pair.index] || 1;
        const normalized = pair.weight / totalWeight;
        const contribution = pair.score * normalized * SYNERGY_SCALE;
        pickContexts[pair.index].synergy += contribution;
        synergyTotal += contribution;
    }

    const counterTotals = new Array<number>(pickContexts.length).fill(0);
    const counterEntries: Array<{
        index: number;
        score: number;
        weight: number;
    }> = [];

    for (let i = 0; i < pickContexts.length; i++) {
        const ctx = pickContexts[i];
        if (!ctx.metrics) continue;
        for (const enemyPick of enemy.picks) {
            if (!enemyPick.championKey) continue;
            const baseWeight = getCounterRoleWeight(ctx.pick.role, enemyPick.role);
            if (baseWeight <= 0) continue;
            const counterEntry = engine.index.getCounterEntry(
                ctx.draftRole,
                ctx.pick.championKey,
                enemyPick.championKey
            );
            if (!counterEntry) continue;
            const score = counterEntry.score;
            if (!Number.isFinite(score) || score === 0) continue;
            counterEntries.push({
                index: i,
                score,
                weight: baseWeight,
            });
            counterTotals[i] += baseWeight;
        }
    }

    let counterTotal = 0;
    for (const entry of counterEntries) {
        const totalWeight = counterTotals[entry.index] || 1;
        const normalized = entry.weight / totalWeight;
        const contribution = entry.score * normalized * COUNTER_SCALE;
        if (!Number.isFinite(contribution) || contribution === 0) continue;
        pickContexts[entry.index].counter += contribution;
        counterTotal += contribution;
    }

    const weights = engine.weights;
    const evaluationPicks: DraftEvaluationPick[] = [];
    let individualScore = 0;
    let exposurePenalty = 0;

    for (const ctx of pickContexts) {
        const metrics = ctx.metrics;
        const draftRole = ctx.draftRole;
        if (!metrics) {
            evaluationPicks.push({
                championKey: ctx.pick.championKey,
                role: ctx.pick.role,
                draftRole,
                intrinsic: 0,
                blind: 0,
                flex: 0,
                reliability: ctx.reliability,
                synergy: ctx.synergy,
                counter: ctx.counter,
                exposure: ctx.exposure,
                deny: ctx.deny,
                total: 0,
            });
            continue;
        }

        const flexScore =
            ctx.flexMetrics?.flexScore ??
            metrics.flexScore ??
            metrics.flexPrior ??
            0;
        const blind = metrics.blind;
        const intrinsic = metrics.intrinsic;
        const reliabilityScore = ctx.reliability;
        const synergyScore = ctx.synergy;
        const counterScore = ctx.counter;
        const exposureScore = ctx.exposure;
        const denyScore = ctx.deny;

        const total =
            intrinsic +
            weights.k1 * reliabilityScore +
            weights.k3 * flexScore +
            weights.k4 * synergyScore +
            weights.k5 * counterScore +
            weights.k6 * denyScore -
            weights.k7 * exposureScore;

        individualScore += intrinsic;
        exposurePenalty += exposureScore;

        evaluationPicks.push({
            championKey: ctx.pick.championKey,
            role: ctx.pick.role,
            draftRole,
            intrinsic,
            blind,
            flex: flexScore,
            reliability: reliabilityScore,
            synergy: synergyScore,
            counter: counterScore,
            exposure: exposureScore,
            deny: denyScore,
            total,
        });
    }

    const compositionEval = evaluateComposition(pickContexts);

    const totalScore =
        evaluationPicks.reduce((sum, pick) => sum + pick.total, 0) +
        compositionEval.bonus -
        compositionEval.penalty;

    const notes: string[] = [...compositionEval.notes];
    if (
        evaluationPicks.length > 0 &&
        Math.max(...evaluationPicks.map((p) => p.synergy)) < 0
    ) {
        notes.push("Faible synergie interne");
    }
    if (
        evaluationPicks.length > 0 &&
        Math.max(...evaluationPicks.map((p) => p.counter)) < 0
    ) {
        notes.push("Matchups defavorables identifies");
    }

    return {
        totalScore,
        individualScore,
        synergyScore: synergyTotal,
        counterScore: counterTotal,
        exposurePenalty,
        compositionScore: compositionEval.bonus,
        riskScore: compositionEval.penalty,
        compositionNotes: compositionEval.notes,
        picks: evaluationPicks,
        notes,
    };
}

export function scoreCandidate(
    engine: DraftEngine,
    teamMap: Map<Role, string>,
    enemyMap: Map<Role, string>,
    candidate: DraftPickDescriptor,
    options: { baselineEvaluation?: DraftEvaluation } = {}
): DraftCandidateScore | undefined {
    const baselineEvaluation =
        options.baselineEvaluation ?? evaluateDraft(engine, teamMap, enemyMap);
    const baselineScore = baselineEvaluation.totalScore;

    const updatedTeam = new Map(teamMap);
    updatedTeam.set(candidate.role, candidate.championKey);
    const evaluation = evaluateDraft(engine, updatedTeam, enemyMap);
    const pick = evaluation.picks.find(
        (p) => p.role === candidate.role && p.championKey === candidate.championKey
    );
    if (!pick) {
        const draftRole = roleIdToDraftRole(candidate.role);
        const metrics = engine.index.getChampionRoleMetrics(
            candidate.championKey,
            draftRole
        );
        const fallbackPick: DraftEvaluationPick = {
            championKey: candidate.championKey,
            role: candidate.role,
            draftRole,
            intrinsic: metrics?.intrinsic ?? 0,
            blind: metrics?.blind ?? 0,
            flex: metrics?.flexScore ?? metrics?.flexPrior ?? 0,
            reliability: metrics?.reliability.relN ?? 0,
            synergy: 0,
            counter: 0,
            exposure: metrics?.exposureScore ?? 0,
            deny: 0,
            total:
                (metrics?.intrinsic ?? 0) +
                engine.weights.k1 * (metrics?.reliability.relN ?? 0) +
                engine.weights.k3 * (metrics?.flexScore ?? metrics?.flexPrior ?? 0) -
                engine.weights.k7 * (metrics?.exposureScore ?? 0),
        };
        return {
            pick: fallbackPick,
            draftScore: evaluation.totalScore - baselineScore,
        };
    }
    return {
        pick,
        draftScore: evaluation.totalScore - baselineScore,
    };
}
