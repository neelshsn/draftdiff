import { type Accessor, createMemo, createSignal, type JSX } from "solid-js";
import { Team } from "@draftgap/core/src/models/Team";

export type NeonTheme = {
    primary: string;
    secondary: string;
    glow: string;
};

export type NeonSurfaceOptions = {
    spotlight?: number;
    baseAlpha?: number;
    hoverLift?: number;
    noiseOpacity?: number;
    enableScale?: boolean;
};

export const NEUTRAL_COLORS = {
    background: "#0B0F16",
    surface: "#111827",
    border: "#1F2937",
    textStrong: "#E5F2FF",
    textMuted: "#94A3B8",
} as const;

export const NEON_THEMES: Record<Team, NeonTheme> = {
    ally: {
        primary: "#00E5FF",
        secondary: "#35A7FF",
        glow: "rgba(0, 229, 255, 0.6)",
    },
    opponent: {
        primary: "#FF316B",
        secondary: "#FF6B6B",
        glow: "rgba(255, 49, 107, 0.55)",
    },
};

export const clampAlpha = (value: number) =>
    Math.max(0, Math.min(1, value));

export const hexToRgba = (hex: string, alpha = 1) => {
    const sanitized = hex.replace("#", "");
    const normalized =
        sanitized.length === 3
            ? sanitized
                  .split("")
                  .map((char) => char + char)
                  .join("")
            : sanitized.padEnd(6, "0").slice(0, 6);

    const value = Number.parseInt(normalized, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;

    return `rgba(${r}, ${g}, ${b}, ${clampAlpha(alpha)})`;
};

export const createNeonSurface = (
    themeAccessor: Accessor<NeonTheme>,
    options: NeonSurfaceOptions = {}
) => {
    const {
        spotlight = 0.32,
        baseAlpha = 0.72,
        hoverLift = 4,
        noiseOpacity = 0.04,
        enableScale = true,
    } = options;

    const [coords, setCoords] = createSignal({ x: 50, y: 50 });
    const [hovered, setHovered] = createSignal(false);

    const style = createMemo<JSX.CSSProperties>(() => {
        const theme = themeAccessor();
        const { x, y } = coords();
        const lift = hovered() ? hoverLift : 0;
        const scale = enableScale && hovered() ? 1.02 : 1;
        const spotColor = hexToRgba(
            theme.primary,
            clampAlpha(spotlight + (hovered() ? 0.12 : 0.05))
        );
        const rimColor = hexToRgba(
            theme.secondary,
            clampAlpha(spotlight + (hovered() ? 0.25 : -0.05))
        );
        const baseColorTop = hexToRgba(
            "#06090F",
            clampAlpha(baseAlpha + (hovered() ? 0.04 : 0))
        );
        const baseColorBottom = hexToRgba(
            NEUTRAL_COLORS.surface,
            clampAlpha(baseAlpha + 0.08)
        );

        return {
            background: [
                `radial-gradient(circle at ${x}% ${y}%, ${spotColor} 0%, rgba(0,0,0,0) 58%)`,
                `repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 2px, transparent 3px, transparent 9px)`,
                `repeating-radial-gradient(circle at 0 0, rgba(255,255,255,${noiseOpacity}) 0px, rgba(255,255,255,${noiseOpacity}) 0.8px, transparent 1px, transparent 4px)`,
                `linear-gradient(0deg, ${baseColorBottom} 0%, ${baseColorTop} 100%)`,
            ].join(", "),
            backgroundSize: "220% 220%, 180% 180%, 128px 128px, 100% 100%",
            backgroundBlendMode: "screen, soft-light, lighten, normal",
            border: "1px solid rgba(148, 163, 184, 0.14)",
            borderColor: hovered()
                ? hexToRgba(theme.primary, 0.82)
                : hexToRgba(theme.secondary, 0.18),
            boxShadow: [
                `0 0 0 1px ${hexToRgba(NEUTRAL_COLORS.border, 0.4)}`,
                hovered()
                    ? `0 10px 28px -14px ${theme.glow}`
                    : `0 6px 24px -16px ${theme.glow}`,
                hovered()
                    ? `0 0 22px -8px ${theme.glow}`
                    : `0 0 18px -10px ${theme.glow}`,
                `inset 0 0 22px -12px ${rimColor}`,
            ].join(", "),
            backdropFilter: "blur(18px)",
            color: NEUTRAL_COLORS.textStrong,
            transform: `translateY(-${lift}px) scale(${scale})`,
            transition:
                "box-shadow 240ms ease, transform 240ms ease, border-color 240ms ease, background 200ms ease, filter 200ms ease",
        };
    });

    const handlePointerMove = (
        event: PointerEvent & { currentTarget: HTMLElement }
    ) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 100;
        const y = ((event.clientY - rect.top) / rect.height) * 100;
        setCoords({
            x: clampAlpha(x / 100) * 100,
            y: clampAlpha(y / 100) * 100,
        });
    };

    const handlePointerEnter = (
        event: PointerEvent & { currentTarget: HTMLElement }
    ) => {
        setHovered(true);
        handlePointerMove(event);
    };

    const handlePointerLeave = () => {
        setHovered(false);
        setCoords({ x: 50, y: 50 });
    };

    return {
        style,
        onPointerEnter: handlePointerEnter,
        onPointerMove: handlePointerMove,
        onPointerLeave: handlePointerLeave,
    };
};

export const getTeamTheme = (team: Team | undefined) =>
    team ? NEON_THEMES[team] : NEON_THEMES.ally;

