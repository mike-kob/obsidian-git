import type { EventRef } from "obsidian";
import { debounce, TFile, TFolder } from "obsidian";
import type ObsidianGit from "./main";
import type { Status } from "./types";

/**
 * Manages git status indicators in the file explorer tree.
 * Adds status letters (M/U/A) and colors to files based on their git status.
 */
export class FileTreeStatusFeature {
    private statusChangeEvent?: EventRef;
    private fileRenameEvent?: EventRef;
    private fileCreateEvent?: EventRef;
    private fileDeleteEvent?: EventRef;
    private layoutReadyEvent?: EventRef;
    private statusMap: Map<string, "M" | "U" | "A"> = new Map();
    private updateDebouncer: () => void;
    private mutationObserver?: MutationObserver;

    constructor(private plugin: ObsidianGit) {
        this.updateDebouncer = debounce(
            () => this.updateFileTree(),
            300,
            true
        );
    }

    public conditionallyActivateBySettings(): void {
        if (this.plugin.settings.showFileTreeStatus) {
            this.activate();
        }
    }

    public activate(): void {
        // Register event for git status changes
        this.statusChangeEvent = this.plugin.app.workspace.on(
            "obsidian-git:status-changed",
            (status: Status) => {
                this.updateStatusMap(status);
                this.updateDebouncer();
            }
        );
        this.plugin.registerEvent(this.statusChangeEvent);

        // Register vault events for file operations
        this.fileRenameEvent = this.plugin.app.vault.on("rename", () => {
            this.updateDebouncer();
        });
        this.plugin.registerEvent(this.fileRenameEvent);

        this.fileCreateEvent = this.plugin.app.vault.on("create", () => {
            this.updateDebouncer();
        });
        this.plugin.registerEvent(this.fileCreateEvent);

        this.fileDeleteEvent = this.plugin.app.vault.on("delete", () => {
            this.updateDebouncer();
        });
        this.plugin.registerEvent(this.fileDeleteEvent);

        // Listen for layout changes to reapply badges when file tree is re-rendered
        this.layoutReadyEvent = this.plugin.app.workspace.on(
            "layout-change",
            () => {
                this.updateDebouncer();
            }
        );
        this.plugin.registerEvent(this.layoutReadyEvent);

        // Setup mutation observer to detect when file explorer is re-rendered
        this.setupMutationObserver();

        // Initial update if status is already available
        if (this.plugin.cachedStatus) {
            this.updateStatusMap(this.plugin.cachedStatus);
            this.updateFileTree();
        }
    }

    public deactivate(): void {
        // Unregister event listeners
        if (this.statusChangeEvent) {
            this.plugin.app.workspace.offref(this.statusChangeEvent);
        }
        if (this.fileRenameEvent) {
            this.plugin.app.vault.offref(this.fileRenameEvent);
        }
        if (this.fileCreateEvent) {
            this.plugin.app.vault.offref(this.fileCreateEvent);
        }
        if (this.fileDeleteEvent) {
            this.plugin.app.vault.offref(this.fileDeleteEvent);
        }
        if (this.layoutReadyEvent) {
            this.plugin.app.workspace.offref(this.layoutReadyEvent);
        }

        // Disconnect mutation observer
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = undefined;
        }

        // Remove all status indicators
        this.removeAllStatusIndicators();
    }

    private updateStatusMap(status: Status): void {
        this.statusMap.clear();

        // Process staged files first (highest priority)
        // Staged files show in the index column
        for (const file of status.staged) {
            const vaultPath = file.vaultPath;
            if (file.index === "A") {
                // Newly added file
                this.statusMap.set(vaultPath, "A");
            } else if (file.index === "M" || file.index === "R" || file.index === "C") {
                // Modified, renamed, or copied file
                this.statusMap.set(vaultPath, "M");
            }
        }

        // Process unstaged/changed files (lower priority)
        // Don't override staged status
        for (const file of status.changed) {
            const vaultPath = file.vaultPath;
            if (!this.statusMap.has(vaultPath)) {
                // Untracked files have workingDir === "U"
                if (file.workingDir === "U") {
                    this.statusMap.set(vaultPath, "U");
                } 
                // Modified files have workingDir === "M"
                else if (file.workingDir === "M" || file.workingDir === "T") {
                    this.statusMap.set(vaultPath, "M");
                }
            }
        }
    }

    private setupMutationObserver(): void {
        // Observe file explorer for changes and reapply badges
        const fileExplorerLeaves = this.plugin.app.workspace.getLeavesOfType(
            "file-explorer"
        );

        if (fileExplorerLeaves.length === 0) return;

        // Create a single mutation observer to watch for tree changes
        this.mutationObserver = new MutationObserver(() => {
            this.updateDebouncer();
        });

        // Start observing all file explorer containers
        for (const leaf of fileExplorerLeaves) {
            const container = leaf.view.containerEl;
            this.mutationObserver.observe(container, {
                childList: true,
                subtree: true,
            });
        }
    }

    private updateFileTree(): void {
        // Temporarily disconnect mutation observer to prevent infinite loop
        // (adding badges triggers the observer, which would call this again)
        const wasObserving = !!this.mutationObserver;
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }
        
        try {
            // Find all file explorer views
            const fileExplorerLeaves = this.plugin.app.workspace.getLeavesOfType(
                "file-explorer"
            );

            for (const leaf of fileExplorerLeaves) {
                const container = leaf.view.containerEl;
                this.updateFileTreeInContainer(container);
            }
        } finally {
            // Reconnect mutation observer
            if (wasObserving) {
                this.setupMutationObserver();
            }
        }
    }

    private updateFileTreeInContainer(container: HTMLElement): void {
        // Find all file items in the tree
        // Obsidian uses .tree-item-self for file/folder items with data-path attribute
        const fileItems = Array.from(
            container.querySelectorAll(".tree-item-self[data-path]")
        );

        for (const item of fileItems) {
            if (!(item instanceof HTMLElement)) continue;
            
            const path = item.getAttribute("data-path");
            if (!path) continue;

            // Skip folders - only process files
            const file = this.plugin.app.vault.getAbstractFileByPath(path);
            if (!file || file instanceof TFolder) continue;
            if (!(file instanceof TFile)) continue;

            const status = this.statusMap.get(path);
            this.updateFileItem(item, path, status);
        }
    }

    private updateFileItem(
        item: HTMLElement,
        _path: string,
        status: "M" | "U" | "A" | undefined
    ): void {
        // Remove existing status indicators
        const existingBadge = item.querySelector(".obsidian-git-status-badge");
        if (existingBadge) {
            existingBadge.remove();
        }

        // Remove existing status classes and attributes
        item.removeAttribute("data-git-status");
        item.classList.remove(
            "obsidian-git-status-M",
            "obsidian-git-status-U",
            "obsidian-git-status-A"
        );

        if (status) {
            // Add status attribute for CSS targeting
            item.setAttribute("data-git-status", status);
            item.classList.add(`obsidian-git-status-${status}`);

            // Create status badge element
            const badge = document.createElement("span");
            badge.className = "obsidian-git-status-badge";
            badge.textContent = status;
            badge.setAttribute("data-status", status);

            // Find the inner content area to append badge
            // Obsidian's file tree uses .tree-item-inner for the clickable area
            const innerEl = item.querySelector(".tree-item-inner");
            if (innerEl) {
                innerEl.appendChild(badge);
            } else {
                // Fallback: append to the item itself
                item.appendChild(badge);
            }
        }
    }

    private removeAllStatusIndicators(): void {
        const fileExplorerLeaves = this.plugin.app.workspace.getLeavesOfType(
            "file-explorer"
        );

        for (const leaf of fileExplorerLeaves) {
            const container = leaf.view.containerEl;
            const badges = container.querySelectorAll(
                ".obsidian-git-status-badge"
            );
            badges.forEach((badge) => badge.remove());

            const items = container.querySelectorAll(
                "[data-git-status], .obsidian-git-status-M, .obsidian-git-status-U, .obsidian-git-status-A"
            );
            items.forEach((item) => {
                item.removeAttribute("data-git-status");
                item.classList.remove(
                    "obsidian-git-status-M",
                    "obsidian-git-status-U",
                    "obsidian-git-status-A"
                );
            });
        }
    }
}

