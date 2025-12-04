<script lang="ts">
    import { setIcon, type EventRef } from "obsidian";
    import { SimpleGit } from "src/gitManager/simpleGit";
    import type ObsidianGit from "src/main";
    import type { LogEntry } from "src/types";
    import { onDestroy, onMount } from "svelte";
    import LogComponent from "./components/logComponent.svelte";
    import type HistoryView from "./historyView";
    import SplitDiffView from "../diff/splitDiffView";
    import DiffView from "../diff/diffView";

    interface Props {
        plugin: ObsidianGit;
        view: HistoryView;
    }

    let { plugin = $bindable(), view }: Props = $props();
    let loading: boolean = $state(false);
    let buttons: HTMLElement[] = $state([]);
    let logs: LogEntry[] | undefined = $state();
    let showTree: boolean = $state(plugin.settings.treeStructure);
    let showCurrentFileOnly: boolean = $state(
        plugin.localStorage.getHistoryShowCurrentFileOnly()
    );
    let currentFilePath: string | undefined = $state();
    let refreshRef: EventRef;
    let fileOpenRef: EventRef;

    let layoutBtn: HTMLElement | undefined = $state();

    $effect(() => {
        if (layoutBtn) {
            layoutBtn.empty();
        }
    });

    refreshRef = view.app.workspace.on(
        "obsidian-git:head-change",
        () => void refresh().catch(console.error)
    );

    fileOpenRef = view.app.workspace.on(
        "file-open",
        (e) => {
            if (showCurrentFileOnly) {
                const splitDiffView = view.app.workspace.getActiveViewOfType(SplitDiffView);
                const diffView = view.app.workspace.getActiveViewOfType(DiffView);

                // Only refresh if we're switching between actual files
                // Don't refresh when opening diff views
                if (splitDiffView === null && diffView === null) {
                    void refresh().catch(console.error);
                }
            }
        }
    );

    $effect(() => {
        buttons.forEach((btn) => setIcon(btn, btn.getAttr("data-icon")!));
    });

    onDestroy(() => {
        view.app.workspace.offref(refreshRef);
        view.app.workspace.offref(fileOpenRef);
    });

    onMount(() => {
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !loading) {
                appendLogs().catch(console.error);
            }
        });
        const sentinel = document.querySelector("#sentinel");
        if (sentinel) {
            observer.observe(sentinel);
        }

        return () => {
            observer.disconnect();
        };
    });

    refresh().catch(console.error);

    function triggerRefresh() {
        refresh().catch(console.error);
    }

    function toggleFileFilter() {
        showCurrentFileOnly = !showCurrentFileOnly;
        plugin.localStorage.setHistoryShowCurrentFileOnly(showCurrentFileOnly);
        setIcon(buttons[2], "file");
        // Reset logs when toggling filter to start fresh
        logs = undefined;
        refresh().catch(console.error);
    }

    async function refresh() {
        if (!plugin.gitReady) {
            logs = undefined;
            return;
        }
        loading = true;
        const isSimpleGit = plugin.gitManager instanceof SimpleGit;
        let limit;
        if ((logs?.length ?? 0) == 0) {
            limit = isSimpleGit ? 50 : 10;
        } else {
            limit = logs!.length;
        }
        
        // Get the file path to filter by if showCurrentFileOnly is enabled
        let filePath: string | undefined = undefined;
        if (showCurrentFileOnly) {
            const activeFile = view.app.workspace.getActiveFile();
            if (activeFile) {
                currentFilePath = activeFile.path;
                filePath = currentFilePath;
            } else {
                // If no active file and filter is enabled, show no commits
                currentFilePath = undefined;
                logs = [];
                loading = false;
                return;
            }
        } else {
            currentFilePath = undefined;
        }
        
        logs = await plugin.gitManager.log(filePath, true, limit);
        loading = false;
    }

    async function appendLogs() {
        if (!plugin.gitReady || logs === undefined || logs.length === 0) {
            return;
        }
        
        // Don't append if filter is enabled but no file is active
        if (showCurrentFileOnly && !currentFilePath) {
            return;
        }
        
        loading = true;
        const isSimpleGit = plugin.gitManager instanceof SimpleGit;
        const limit = isSimpleGit ? 50 : 10;
        
        // Use the same file path that was used in the initial refresh
        const filePath = showCurrentFileOnly ? currentFilePath : undefined;
        
        const newLogs = await plugin.gitManager.log(
            filePath,
            true,
            limit,
            logs.last()?.hash
        );
        // Remove the first element of the new logs, as it is the same as the last element of the current logs.
        // And don't use hash^ as it fails for the first commit.
        logs.push(...newLogs.slice(1));
        loading = false;
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<main class="git-view">
    <div class="nav-header">
        <div class="nav-buttons-container">
            <div
                id="layoutChange"
                class="clickable-icon nav-action-button"
                data-icon={showTree ? "list" : "folder"}
                aria-label="Change Layout"
                bind:this={buttons[0]}
                onclick={() => {
                    showTree = !showTree;
                    setIcon(buttons[0], showTree ? "list" : "folder");
                    plugin.settings.treeStructure = showTree;
                    void plugin.saveSettings();
                }}
            ></div>
            <div
                id="fileFilter"
                class="clickable-icon nav-action-button"
                class:is-active={showCurrentFileOnly}
                data-icon="file"
                aria-label="Show history for current file only"
                bind:this={buttons[2]}
                onclick={toggleFileFilter}
            ></div>
            <div
                id="refresh"
                class="clickable-icon nav-action-button"
                class:loading
                data-icon="refresh-cw"
                aria-label="Refresh"
                bind:this={buttons[1]}
                onclick={triggerRefresh}
            ></div>
        </div>
    </div>
    {#if showCurrentFileOnly && currentFilePath}
        <div class="git-history-filter-info">
            History for <span class="git-history-filename">{currentFilePath}</span>
        </div>
    {/if}
    <div class="nav-files-container" style="position: relative;">
        {#if logs}
            <div class="tree-item nav-folder mod-root">
                {#each logs as log}
                    <LogComponent {view} {showTree} {log} {plugin} isFiltered={showCurrentFileOnly} />
                {/each}
            </div>
        {/if}
        <div id="sentinel"></div>
        <!-- Ensure that the sentinel item is reachable with the overlaying status bar and indicate that the end of the list is reached  -->
        <div style="margin-bottom:40px"></div>
    </div>
</main>

<style lang="scss">
    .git-history-filter-info {
        padding: 0 12px 8px;
        font-size: var(--font-ui-smaller);
        color: var(--text-muted);
        border-bottom: 1px solid var(--background-modifier-border);
        background-color: var(--background-secondary);
        text-align: center;
    }

    .git-history-filename {
        color: var(--text-normal);
        font-weight: var(--font-semibold);
    }
</style>
