<script lang="ts">
    import { moment } from "obsidian";
    import type ObsidianGit from "src/main";
    import type { LogEntry } from "src/types";
    import { getTooltipSide } from "src/utils";
    import { slide } from "svelte/transition";
    import type HistoryView from "../historyView";
    import LogFileComponent from "./logFileComponent.svelte";
    import LogTreeComponent from "./logTreeComponent.svelte";

    interface Props {
        log: LogEntry;
        view: HistoryView;
        showTree: boolean;
        plugin: ObsidianGit;
        isFiltered: boolean;
    }

    let { log, view, showTree, plugin, isFiltered }: Props = $props();
    let currentLog: LogEntry | undefined = $state();
    let displayedLog = $derived(currentLog ?? log);
    let showingFullDiff = $state(false);
    let loadingFullDiff = $state(false);

    $effect(() => {
        currentLog = undefined;
        showingFullDiff = false;
    });
    let logsHierarchy = $derived({
        title: "",
        path: "",
        vaultPath: "",
        children: plugin.gitManager.getTreeStructure(displayedLog.diff.files),
    });

    let side = $derived(getTooltipSide(view.leaf));
    let isCollapsed = $state(true);
    let closed = $state<Record<string, boolean>>({});

    function authorToString(log: LogEntry) {
        const name = log.author.name;
        if (plugin.settings.authorInHistoryView == "full") {
            return name;
        } else if (plugin.settings.authorInHistoryView == "initials") {
            const words = name.split(" ").filter((word) => word.length > 0);

            return words.map((word) => word[0]!.toUpperCase()).join("");
        }
        return "";
    }

    async function loadFullDiff() {
        if (loadingFullDiff || showingFullDiff) return;

        loadingFullDiff = true;
        try {
            const fullLogs = await plugin.gitManager.log(
                undefined,
                false,
                1,
                log.hash
            );
            if (fullLogs.length > 0) {
                currentLog = fullLogs[0]!;
                showingFullDiff = true;
            }
        } catch (error) {
            console.error("Failed to load full diff:", error);
        } finally {
            loadingFullDiff = false;
        }
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<main>
    <div class="tree-item nav-folder" class:is-collapsed={isCollapsed}>
        <div
            class="tree-item-self is-clickable nav-folder-title"
            aria-label={`${log.refs.length > 0 ? log.refs.join(", ") + "\n" : ""}${log.author?.name}
${moment(log.date).format(plugin.settings.commitDateFormat)}
${log.message}`}
            data-tooltip-position={side}
            onclick={() => (isCollapsed = !isCollapsed)}
        >
            <div
                class="tree-item-icon nav-folder-collapse-indicator collapse-icon"
                class:is-collapsed={isCollapsed}
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="svg-icon right-triangle"
                    ><path d="M3 8L12 17L21 8" /></svg
                >
            </div>
            <div>
                {#if log.refs.length > 0}
                    <div class="git-ref">
                        {log.refs.join(", ")}
                    </div>
                {/if}
                {#if plugin.settings.authorInHistoryView != "hide" && log.author?.name}
                    <div class="git-author">
                        {authorToString(log)}
                    </div>
                {/if}
                {#if plugin.settings.dateInHistoryView}
                    <div class="git-date">
                        {moment(log.date).format(
                            plugin.settings.commitDateFormat
                        )}
                    </div>
                {/if}

                <div class="tree-item-inner nav-folder-title-content">
                    {log.message}
                </div>
            </div>
        </div>
        {#if !isCollapsed}
            <div
                class="tree-item-children nav-folder-children"
                transition:slide|local={{ duration: 150 }}
            >
                {#if showTree}
                    <LogTreeComponent
                        hierarchy={logsHierarchy}
                        {plugin}
                        {view}
                        topLevel={true}
                        bind:closed
                    />
                {:else}
                    {#each displayedLog.diff.files as file}
                        <LogFileComponent {view} diff={file} />
                    {/each}
                {/if}
                {#if isFiltered && !showingFullDiff && displayedLog.diff.files.length > 0}
                    <div class="git-history-show-full">
                        <button
                            class="git-history-show-full-button"
                            onclick={loadFullDiff}
                            disabled={loadingFullDiff}
                        >
                            {loadingFullDiff ? "Loading..." : "Show full diff"}
                        </button>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
</main>

<style lang="scss">
    .git-history-show-full {
        padding: 0 0 4px 24px;
        font-size: var(--font-ui-smaller);
    }

    .git-history-show-full-button {
        background: none;
        border: none;
        padding: 0;
        color: var(--text-faint);
        cursor: pointer;
        text-decoration: none;
        font-size: var(--font-ui-smaller);
        box-shadow: none;
        height: 16px;

        &:hover {
            text-decoration: underline;
        }

        &:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
    }
</style>
