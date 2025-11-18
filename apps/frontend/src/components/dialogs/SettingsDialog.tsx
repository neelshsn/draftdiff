import { Icon } from "solid-heroicons";
import { questionMarkCircle } from "solid-heroicons/solid-mini";
import { For, Show } from "solid-js";
import { useDataset } from "../../contexts/DatasetContext";
import { ButtonGroup, ButtonGroupOption } from "../common/ButtonGroup";
import { buttonVariants } from "../common/Button";
import { Switch } from "../common/Switch";
import { cn } from "../../utils/style";
import {
    RiskLevel,
    displayNameByRiskLevel,
} from "@draftgap/core/src/risk/risk-level";
import { useUser } from "../../contexts/UserContext";
import { useMedia } from "../../hooks/useMedia";
import {
    DraftTablePlacement,
    StatsSite,
} from "@draftgap/core/src/models/user/Config";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "../common/Dialog";
import { FAQDialog } from "./FAQDialog";

export default function SettingsDialog() {
    const { isDesktop } = useMedia();
    const { config, setConfig } = useUser();
    const { reload, proPatches } = useDataset();

    const riskLevelOptions: ButtonGroupOption<RiskLevel>[] = RiskLevel.map(
        (level) => ({
            value: level,
            label: displayNameByRiskLevel[level],
        })
    );

    const dataSourceOptions = [
        { value: "riot" as const, label: "Riot API" },
        { value: "pro" as const, label: "Pro Mode" },
    ];

    const proPatchOptions = () => {
        const patches = proPatches();
        const latestPatch = patches[0];
        const entries: { value: string; label: string }[] = [
            {
                value: "latest",
                label: latestPatch
                    ? `Latest patch (${latestPatch})`
                    : "Latest patch",
            },
            {
                value: "all",
                label: "All patches",
            },
        ];
        for (const patch of patches) {
            entries.push({
                value: patch,
                label: `Patch ${patch}`,
            });
        }
        return entries;
    };

    const draftTablePlacementOptions = [
        {
            value: DraftTablePlacement.Bottom,
            label: "Bottom",
        },
        {
            value: DraftTablePlacement.InPlace,
            label: "In Place",
        },
        {
            value: DraftTablePlacement.Hidden,
            label: "Hidden",
        },
    ];

    const statsSiteOptions = [
        {
            value: "lolalytics",
            label: "lolalytics",
        },
        {
            value: "u.gg",
            label: "u.gg",
        },
        {
            value: "op.gg",
            label: "op.gg",
        },
    ] as const;

    return (
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Settings</DialogTitle>
            </DialogHeader>
            <div>
                <h3 class="text-3xl uppercase">Draft</h3>
                <div class="flex space-x-16 items-center justify-between mt-2">
                    <span class="text-lg uppercase">
                        Ignore individual champion winrates
                    </span>
                    <Switch
                        checked={config.ignoreChampionWinrates}
                        onChange={() =>
                            setConfig({
                                ignoreChampionWinrates:
                                    !config.ignoreChampionWinrates,
                            })
                        }
                    />
                </div>
                <div class="flex items-center mt-1 mb-1 gap-1">
                    <span class="text-lg uppercase block">Risk level</span>
                    <Dialog>
                        <DialogTrigger>
                            <Icon
                                path={questionMarkCircle}
                                class="w-5 inline text-neutral-400 -mt-1"
                            />
                        </DialogTrigger>
                        <FAQDialog />
                    </Dialog>
                </div>
                <ButtonGroup
                    options={riskLevelOptions}
                    selected={config.riskLevel}
                    size="sm"
                    onChange={(value: RiskLevel) =>
                        setConfig({
                            riskLevel: value,
                        })
                    }
                />
            </div>
            <div class="mt-6">
                <h3 class="text-3xl uppercase">Data</h3>
                <div class="flex flex-col gap-1 mt-2">
                    <span class="text-lg uppercase">Data source</span>
                    <ButtonGroup
                        options={dataSourceOptions}
                        selected={config.dataSource}
                        size="sm"
                        onChange={(value) =>
                            setConfig({
                                dataSource: value,
                            })
                        }
                    />
                </div>
                <p class="text-xs uppercase text-neutral-400 mt-2">
                    Pro mode uses the offline dataset with recency weighting.
                </p>
                <Show when={config.dataSource === "pro"}>
                    <div class="mt-3 flex flex-col gap-3">
                        <div class="flex flex-col gap-2">
                            <span class="text-lg uppercase">Patch filter</span>
                            <select
                                class="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm uppercase tracking-wide text-neutral-200 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                value={config.proPatch}
                                onChange={(event) =>
                                    setConfig({ proPatch: event.currentTarget.value })
                                }
                            >
                                <For each={proPatchOptions()}>
                                    {(option) => (
                                        <option value={option.value}>{option.label}</option>
                                    )}
                                </For>
                            </select>
                        </div>
                        <p class="text-xs uppercase text-neutral-400 leading-relaxed">
                            Pick the patch you want to mirror. "Latest patch" always follows the
                            newest data available, while "All patches" keeps every sample.
                        </p>
                        <button
                            type="button"
                            class={cn(buttonVariants({ variant: "secondary" }), "w-fit")}
                            onClick={reload}
                        >
                            Reload data
                        </button>
                    </div>
                </Show>
            </div>
            <div>
                <h3 class="text-3xl uppercase">UI</h3>
                <div class="flex space-x-8 items-center justify-between mt-2">
                    <span class="text-lg uppercase">
                        Place champion pool at top of suggestions
                    </span>
                    <Switch
                        checked={config.showFavouritesAtTop}
                        onChange={() =>
                            setConfig({
                                showFavouritesAtTop:
                                    !config.showFavouritesAtTop,
                            })
                        }
                    />
                </div>

                <Show when={isDesktop}>
                    <div class="flex flex-col gap-1 mt-2">
                        <span class="text-lg uppercase">
                            Place banned champion suggestions at
                        </span>
                        <ButtonGroup
                            options={draftTablePlacementOptions}
                            selected={config.banPlacement}
                            size="sm"
                            onChange={(v) =>
                                setConfig({
                                    banPlacement: v,
                                })
                            }
                        />
                    </div>
                    <div class="flex flex-col gap-1 mt-2">
                        <span class="text-lg uppercase">
                            Place unowned champion suggestions at
                        </span>
                        <ButtonGroup
                            options={[
                                {
                                    value: DraftTablePlacement.Bottom,
                                    label: "Bottom",
                                },
                                {
                                    value: DraftTablePlacement.InPlace,
                                    label: "In Place",
                                },
                                {
                                    value: DraftTablePlacement.Hidden,
                                    label: "Hidden",
                                },
                            ]}
                            size="sm"
                            selected={config.unownedPlacement}
                            onChange={(v) =>
                                setConfig({
                                    unownedPlacement: v,
                                })
                            }
                        />
                    </div>
                </Show>

                <div class="flex space-x-8 items-center justify-between mt-2">
                    <span class="text-lg uppercase">
                        Show advanced winrates
                    </span>
                    <Switch
                        checked={config.showAdvancedWinrates}
                        onChange={() =>
                            setConfig({
                                showAdvancedWinrates:
                                    !config.showAdvancedWinrates,
                            })
                        }
                    />
                </div>
            </div>

            <Show when={isDesktop}>
                <div>
                    <h3 class="text-3xl uppercase">League Client</h3>
                    <div class="flex space-x-16 items-center justify-between mt-2">
                        <span class="text-lg uppercase">
                            Disable league client integration
                        </span>
                        <Switch
                            checked={config.disableLeagueClientIntegration}
                            onChange={() =>
                                setConfig({
                                    disableLeagueClientIntegration:
                                        !config.disableLeagueClientIntegration,
                                })
                            }
                        />
                    </div>
                </div>
            </Show>

            <div>
                <h3 class="text-3xl uppercase">Misc</h3>
                <div class="flex flex-col gap-1 mt-2">
                    <span class="text-lg uppercase">Favourite builds site</span>
                    <ButtonGroup
                        options={statsSiteOptions}
                        selected={config.defaultStatsSite}
                        size="sm"
                        onChange={(value: StatsSite) =>
                            setConfig({
                                defaultStatsSite: value,
                            })
                        }
                    />
                </div>
            </div>
        </DialogContent>
    );
}

