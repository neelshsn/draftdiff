import { DraftResult } from "@draftgap/core/src/draft/analysis";
import { PickData } from "@draftgap/core/src/models/dataset/PickData";
import { Role } from "@draftgap/core/src/models/Role";
import { ratingToWinrate } from "@draftgap/core/src/rating/ratings";
import type { DraftStrategy } from "../contexts/DraftStrategyContext";

export type CompositionSummary = {
    label: string;
    notes: string[];
};

interface CompositionInput {
    draftResult: DraftResult | undefined;
    teamData: Map<string, PickData>;
    teamComp: Map<Role, string>;
}

const SPLIT_ROLES: Role[] = [0, 2];
const PROTECT_ROLES: Role[] = [3, 4];

export function classifyComposition({
    draftResult,
    teamData,
    teamComp,
}: CompositionInput): CompositionSummary | undefined {
    if (!draftResult || teamComp.size === 0) {
        return undefined;
    }

    const synergyScore = ratingToWinrate(draftResult.allyDuoRating.totalRating) - 0.5;
    const counterScore = ratingToWinrate(draftResult.matchupRating.totalRating) - 0.5;
    const performanceScore = ratingToWinrate(draftResult.allyChampionRating.totalRating) - 0.5;

    let totalMagic = 0;
    let totalPhysical = 0;
    let carryCs = 0;
    let carryCount = 0;
    let supportVision = 0;
    let highSplitLanes = 0;

    for (const [role, championKey] of teamComp.entries()) {
        const pick = teamData.get(championKey);
        if (!pick) continue;
        const roleData = pick.statsByRole[role];
        if (!roleData) continue;

        const performance = roleData.performance;
        if (performance) {
            if (performance.csPerMinute > 0) {
                carryCs += performance.csPerMinute;
                carryCount += 1;
            }
            if (role === 4) {
                supportVision = performance.visionScorePerMinute;
            }
            if (
                SPLIT_ROLES.includes(role) &&
                performance.csPerMinute >= 6 &&
                performance.killsPerGame >= 3
            ) {
                highSplitLanes += 1;
            }
        }

        const damage = roleData.damageProfile;
        totalMagic += damage.magic;
        totalPhysical += damage.physical;
    }

    const avgCs = carryCount > 0 ? carryCs / carryCount : 0;
    const totalDamage = totalMagic + totalPhysical;
    const magicShare = totalDamage > 0 ? totalMagic / totalDamage : 0.5;

    const notes: string[] = [];
    let label: DraftStrategy = "balanced";

    if (synergyScore >= 0.025) {
        label = "teamfight";
        notes.push("Synergies positives : focus teamfight");
    }

    if (highSplitLanes >= 1 && synergyScore <= 0.02) {
        label = "split";
        notes.push("Side lanes prêts à push");
    }

    if (
        label === "balanced" &&
        avgCs >= 5.5 &&
        PROTECT_ROLES.every((role) => teamComp.has(role))
    ) {
        label = "protect";
        notes.push("Carry principal à protéger");
    }

    if (label === "balanced" && counterScore >= 0.025) {
        label = "catch";
        notes.push("Beaucoup d'outils de catch");
    }

    if (label === "balanced" && magicShare >= 0.55 && counterScore >= 0.015) {
        label = "poke";
        notes.push("Profil poke/siege prononcé");
    }

    if (label === "balanced" && synergyScore >= 0.015) {
        label = "teamfight";
    }

    if (label === "balanced" && performanceScore >= 0.02) {
        notes.push("Cartes pour scaling late game");
    }

    if (supportVision >= 1.2) {
        notes.push("Vision de support solide");
    }

    return {
        label,
        notes,
    };
}

