export function clamp(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

export function safeDivide(
    numerator: number,
    denominator: number,
    fallback = 0
) {
    if (!Number.isFinite(numerator)) return fallback;
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) {
        return fallback;
    }
    return numerator / denominator;
}

export function betaBinomialAdjust(
    wins: number,
    games: number,
    priorMean: number,
    priorStrength: number
) {
    const a0 = priorMean * priorStrength;
    const b0 = priorStrength - a0;
    return safeDivide(wins + a0, games + a0 + b0, priorMean);
}

export function shrinkToMean(
    value: number,
    sample: number,
    priorMean: number,
    priorStrength: number
) {
    const weight = safeDivide(sample, sample + priorStrength, 0);
    return priorMean + weight * (value - priorMean);
}

export function computeZScore(
    value: number,
    mean: number,
    std: number,
    fallback = 0
) {
    if (!Number.isFinite(value)) return fallback;
    if (!Number.isFinite(std) || std < 1e-9) return fallback;
    return (value - mean) / std;
}

export function logistic(value: number, slope = 1) {
    if (!Number.isFinite(value)) return 0.5;
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-9) {
        slope = 1;
    }
    return 1 / (1 + Math.exp(-value / slope));
}

export function saturate(value: number, k: number) {
    if (!Number.isFinite(value) || !Number.isFinite(k) || k <= 0) return 0;
    return Math.tanh(value / k);
}

