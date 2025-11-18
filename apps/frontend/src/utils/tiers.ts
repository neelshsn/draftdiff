import { ratingToWinrate } from "@draftgap/core/src/rating/ratings";

export type TierInfo = {
    label: string;
    colorClass: string;
    textClass: string;
    accentClass: string;
};

const TIER_SCALE: { min: number; label: string; colors: [string, string] }[] = [
    { min: 0.585, label: "S+", colors: ["from-fuchsia-500", "to-amber-400"] },
    { min: 0.57, label: "S", colors: ["from-fuchsia-400", "to-sky-300"] },
    { min: 0.555, label: "S-", colors: ["from-emerald-400", "to-sky-300"] },
    { min: 0.545, label: "A+", colors: ["from-emerald-400", "to-lime-300"] },
    { min: 0.535, label: "A", colors: ["from-emerald-300", "to-teal-300"] },
    { min: 0.525, label: "A-", colors: ["from-teal-300", "to-cyan-300"] },
    { min: 0.515, label: "B+", colors: ["from-cyan-300", "to-sky-300"] },
    { min: 0.505, label: "B", colors: ["from-sky-300", "to-blue-400"] },
    { min: 0.495, label: "B-", colors: ["from-blue-400", "to-indigo-400"] },
    { min: 0.485, label: "C+", colors: ["from-indigo-400", "to-violet-500"] },
    { min: 0.475, label: "C", colors: ["from-violet-500", "to-purple-500"] },
    { min: 0.465, label: "C-", colors: ["from-purple-500", "to-rose-500"] },
    { min: 0.455, label: "D+", colors: ["from-rose-500", "to-orange-500"] },
    { min: 0.445, label: "D", colors: ["from-orange-500", "to-amber-500"] },
    { min: 0, label: "D-", colors: ["from-neutral-700", "to-neutral-800"] },
];

function buildTierInfo(winrate: number): TierInfo {
    const tier = TIER_SCALE.find((entry) => winrate >= entry.min) ?? TIER_SCALE.at(-1)!;
    const gradient = `bg-gradient-to-r ${tier.colors[0]} ${tier.colors[1]} shadow-lg`;
    const text =
        tier.min >= 0.535
            ? "text-neutral-900"
            : tier.min >= 0.485
            ? "text-neutral-100"
            : "text-neutral-200";

    return {
        label: tier.label,
        colorClass: gradient,
        textClass: text,
        accentClass:
            tier.min >= 0.535
                ? "shadow-[0_0_25px_rgba(255,255,255,0.35)]"
                : "shadow-[0_0_12px_rgba(0,0,0,0.4)]",
    };
}

export function ratingToTierInfo(rating: number): TierInfo {
    const winrate = ratingToWinrate(rating);
    return buildTierInfo(winrate);
}

export function winrateToTierInfo(winrate: number): TierInfo {
    return buildTierInfo(winrate);
}

function clampWinrate(value: number) {
    if (!Number.isFinite(value)) {
        return 0.5;
    }
    if (value < 0) {
        return 0;
    }
    if (value > 1) {
        return 1;
    }
    return value;
}

export function impactToTierInfo(delta: number): TierInfo {
    return buildTierInfo(clampWinrate(0.5 + delta));
}

export function contributionToTierInfo(delta: number): TierInfo {
    return buildTierInfo(clampWinrate(0.5 + delta));
}

export function formatWinrate(value: number, decimals = 1) {
    return `${(value * 100).toFixed(decimals)}%`;
}

export function formatWinrateDelta(value: number, decimals = 1) {
    if (!Number.isFinite(value) || value === 0) {
        return "±0%";
    }
    const sign = value > 0 ? "+" : "";
    return `${sign}${(value * 100).toFixed(decimals)}%`;
}
