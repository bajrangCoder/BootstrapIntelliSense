import plugin from '../plugin.json';

const appSettings = acode.require("settings");
const bootstrapCssFileUrl: string = "https://cdn.jsdelivr.net/npm/bootstrap@latest/dist/css/bootstrap.css";

type CodeMirrorCompletionContext = {
    pos: number;
    explicit: boolean;
    state: {
        doc: {
            lineAt: (position: number) => {
                from: number;
                text: string;
            };
        };
    };
    matchBefore: (expression: RegExp) => { from: number; to: number } | null;
};

type CodeMirrorCompletion = {
    label: string;
    type: string;
    detail: string;
};

type CodeMirrorCompletionResult = {
    from: number;
    options: CodeMirrorCompletion[];
    validFor: RegExp;
};

class BootstrapIntelliSense {
    public baseUrl: string | undefined;

    private $cacheFile!: any;

    private bootstrapClasses: string[] = [];
    private aceCompletionItems: AceAjax.Completion[] = [];
    private codeMirrorCompletionItems: CodeMirrorCompletion[] = [];

    private aceCompleter: {
        getCompletions: (editor: AceAjax.Editor, session: any, pos: AceAjax.Position, prefix: string, callback: (err: any, results: AceAjax.Completion[]) => void) => void;
    } | null = null;

    private codeMirrorCompletionCompartment: any = null;
    private hasCodeMirrorCompletionAttached = false;
    private attachedCodeMirrorState: any = null;
    private hasCodeMirrorListeners = false;

    private readonly codeMirrorLifecycleEvents: FileEvent[] = [
        "switch-file",
        "file-loaded",
    ];

    private readonly onCodeMirrorLifecycleChange = () => {
        this.configureCodeMirrorAutocompletion();
    };

    private readonly codeMirrorCompletionSource = (context: CodeMirrorCompletionContext): CodeMirrorCompletionResult | null => {
        if (!this.isSupportedCodeMirrorFile()) {
            return null;
        }

        const line = context.state.doc.lineAt(context.pos);
        const lineBeforeCursor = line.text.slice(0, context.pos - line.from);
        if (!this.isInsideClassAttribute(lineBeforeCursor)) {
            return null;
        }

        const word = context.matchBefore(/[\w-]*/);
        if (!word) {
            return null;
        }
        if (word.from === word.to && !context.explicit) {
            return null;
        }

        return {
            from: word.from,
            options: this.codeMirrorCompletionItems,
            validFor: /[\w-]*/,
        };
    };

    private injectAutocompleteStyles(cssText: string) {
        const mountStyle = (target: ParentNode) => {
            if (!("querySelector" in target)) {
                return;
            }
            const existingStyle = (target as ParentNode).querySelector<HTMLStyleElement>(
                `style[data-bootstrap-intellisense-style="${plugin.id}"]`,
            );
            if (existingStyle) {
                existingStyle.textContent = cssText;
                return;
            }

            const styleElement = document.createElement("style");
            styleElement.setAttribute("data-bootstrap-intellisense-style", plugin.id);
            styleElement.textContent = cssText;
            target.appendChild(styleElement);
        };

        mountStyle(document.head);

        const cmEditor = editorManager.editor as any;
        const cmRoot = cmEditor?.dom?.getRootNode?.();
        if (cmRoot && cmRoot !== document && "appendChild" in cmRoot) {
            mountStyle(cmRoot as ParentNode);
        }
    }

    constructor(){
        if (!appSettings.value[plugin.id]) {
            appSettings.value[plugin.id] = {
                bootstrapUrl: bootstrapCssFileUrl,
            };
            appSettings.update(false);
        }
    }
    
    private async fetchBootstrapClasses() {
        try {
            const response = await fetch(this.settings.bootstrapUrl || bootstrapCssFileUrl);
            const extractedCss = await response.text();
            // Use a regular expression to match class names
            const classRegex = /\.(?!\d)([\w-]+)/g;
            const classes = new Set<string>();
            let match;
            while ((match = classRegex.exec(extractedCss))) {
                classes.add(match[1]);
            }
            return Array.from(classes);
        } catch (error: any) {
            acode.alert("Bootstrap Intellige", `Error fetching or storing Bootstrap classes: ${error}`);
            return []; // Return an empty array
        }
    }

    private isCodeMirrorEditor(): boolean {
        return editorManager.isCodeMirror === true;
    }

    private isSupportedMode(modeId: string): boolean {
        const normalizedMode = modeId.toLowerCase();
        return normalizedMode.includes("html") || normalizedMode.includes("jsx");
    }

    private isSupportedCodeMirrorFile(): boolean {
        const manager: any = editorManager;
        const activeFile: any = typeof manager.activeFile === "function"
            ? manager.activeFile()
            : manager.activeFile;

        const mode = String(activeFile?.currentMode || activeFile?.mode || "").toLowerCase();
        if (mode.includes("html") || mode.includes("jsx") || mode.includes("tsx") || mode.includes("markup")) {
            return true;
        }

        const fileName = String(activeFile?.filename || activeFile?.name || "").toLowerCase();
        const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
        return ["html", "htm", "xhtml", "jsx", "tsx"].includes(String(extension || ""));
    }

    private getActiveModeId(): string {
        const manager: any = editorManager;
        const activeFile: any = typeof manager.activeFile === "function"
            ? manager.activeFile()
            : manager.activeFile;
        const mode = activeFile?.currentMode || activeFile?.mode;
        if (!mode) return "";
        return String(mode);
    }

    private isInsideClassAttribute(lineBeforeCursor: string): boolean {
        return /\b(class|className)\s*=\s*(?:\{\s*)?["'][^"']*$/.test(lineBeforeCursor);
    }

    private setCompletionDataset(classes: string[]) {
        this.bootstrapClasses = [...classes];
        this.aceCompletionItems = this.bootstrapClasses.map((className) => ({
            caption: className,
            value: className,
            meta: "bootstrap",
        }));
        this.codeMirrorCompletionItems = this.bootstrapClasses.map((className) => ({
            label: className,
            type: "bootstrap",
            detail: "bootstrap",
        }));
    }

    private addCodeMirrorLifecycleListeners() {
        if (this.hasCodeMirrorListeners) {
            return;
        }
        this.codeMirrorLifecycleEvents.forEach((eventName) => {
            editorManager.on(eventName, this.onCodeMirrorLifecycleChange);
        });
        this.hasCodeMirrorListeners = true;
    }

    private removeCodeMirrorLifecycleListeners() {
        if (!this.hasCodeMirrorListeners) {
            return;
        }
        this.codeMirrorLifecycleEvents.forEach((eventName) => {
            editorManager.off(eventName, this.onCodeMirrorLifecycleChange);
        });
        this.hasCodeMirrorListeners = false;
    }

    private removeAceAutocompletion() {
        const editor = editorManager.editor as any;
        if (!editor?.completers || !this.aceCompleter) {
            return;
        }
        editor.completers = editor.completers.filter((completer: any) => completer !== this.aceCompleter);
        this.aceCompleter = null;
    }

    private configureAceAutocompletion() {
        const editor = editorManager.editor as any;
        if (!editor?.completers) {
            return;
        }

        this.removeAceAutocompletion();
        if (!this.aceCompletionItems.length) {
            return;
        }

        this.aceCompleter = {
            getCompletions: (_editor: AceAjax.Editor, session: any, pos: AceAjax.Position, _prefix: string, callback: (err: any, results: AceAjax.Completion[]) => void) => {
                const modeId = String(session?.getMode?.()?.$id || "");
                if (!this.isSupportedMode(modeId)) {
                    callback(null, []);
                    return;
                }

                const lineBeforeCursor = String(session?.getLine?.(pos.row) || "").slice(0, pos.column);
                if (!this.isInsideClassAttribute(lineBeforeCursor)) {
                    callback(null, []);
                    return;
                }

                callback(null, this.aceCompletionItems);
            }
        };

        editor.completers.unshift(this.aceCompleter);
    }

    private configureCodeMirrorAutocompletion() {
        const editor = editorManager.editor as any;
        const readOnlyCompartment = editorManager.readOnlyCompartment as any;

        if (!editor?.state || !editor?.dispatch) {
            return;
        }

        const languageDataFacet = editor.state.constructor?.languageData;
        const reconfigureProbe = readOnlyCompartment?.reconfigure?.([]);
        const appendConfigEffect = reconfigureProbe?.constructor?.appendConfig;
        const compartmentClass = readOnlyCompartment?.constructor;

        if (!compartmentClass || !languageDataFacet?.of || !appendConfigEffect?.of) {
            if (!languageDataFacet?.of || !appendConfigEffect?.of) return;

            const extension = languageDataFacet.of(() => [
                { autocomplete: this.codeMirrorCompletionSource },
            ]);
            if (this.attachedCodeMirrorState === editor.state) {
                return;
            }
            editor.dispatch({
                effects: appendConfigEffect.of(extension),
            });
            this.attachedCodeMirrorState = editor.state;
            this.hasCodeMirrorCompletionAttached = true;
            return;
        }

        if (!this.codeMirrorCompletionCompartment) {
            this.codeMirrorCompletionCompartment = new compartmentClass();
        }

        const extension = languageDataFacet.of(() => [
            { autocomplete: this.codeMirrorCompletionSource },
        ]);

        if (this.hasCodeMirrorCompletionAttached) {
            try {
                editor.dispatch({
                    effects: this.codeMirrorCompletionCompartment.reconfigure(extension),
                });
                this.attachedCodeMirrorState = editor.state;
                return;
            } catch (_error) {
                this.hasCodeMirrorCompletionAttached = false;
            }
        }

        editor.dispatch({
            effects: appendConfigEffect.of(
                this.codeMirrorCompletionCompartment.of(extension),
            ),
        });
        this.hasCodeMirrorCompletionAttached = true;
        this.attachedCodeMirrorState = editor.state;
    }

    private removeCodeMirrorAutocompletion() {
        if (!this.hasCodeMirrorCompletionAttached) {
            return;
        }

        if (!this.codeMirrorCompletionCompartment) {
            this.hasCodeMirrorCompletionAttached = false;
            this.attachedCodeMirrorState = null;
            return;
        }

        const editor = editorManager.editor as any;
        if (!editor?.dispatch) {
            this.hasCodeMirrorCompletionAttached = false;
            return;
        }

        try {
            editor.dispatch({
                effects: this.codeMirrorCompletionCompartment.reconfigure([]),
            });
        } finally {
            this.hasCodeMirrorCompletionAttached = false;
            this.attachedCodeMirrorState = null;
        }
    }

    private initializeAutocompletion(classes: Array<string>) {
        this.setCompletionDataset(classes);

        if (this.isCodeMirrorEditor()) {
            this.removeAceAutocompletion();
            this.addCodeMirrorLifecycleListeners();
            this.configureCodeMirrorAutocompletion();
            return;
        }

        this.removeCodeMirrorAutocompletion();
        this.removeCodeMirrorLifecycleListeners();
        this.configureAceAutocompletion();
    }

    async init($page: WCPage, cacheFile: any, cacheFileUrl: string): Promise<void> {
        const autocompleteCss = `
        .ace_autocomplete .ace_completion-icon.ace_bootstrap {
            background-size: contain;
            background-repeat: no-repeat;
            height: 1em;
            width: 1em;
            background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAES0lEQVR42p2XA5AESwyGv3TP4tm2bdu2bdu2bdu2bdu2zfPtTucddi81Nap6X9V/N84mlXTSAnDW+DqJaDgRZEVgAqCigKIomNrnmn0PO897t6HKb0HlYVdtHAr8IudOrBOEhr4KTE2LMuMU3S+4hybOv5RmY0E5Z/z4MlXZHsj0gJTnZcYBOy98N8AlTlXWIoViR6aAptT+m/y5FMgQ1bXl7PFCACQv9KFlAMXOMyMlJI8FyiOnUdJ4krafQQfU9lQ1M/SItM4EcC2BquQZB5AIIxG+ljkCMXt+XGe0CYQ8ev5Wun4PfPpkg+cv6uXvbwQRD3gAFCELBaLirA+E0MRXKGSUsWVAnvGn9yywZY279uvgzZsaOATBQ0HSOiWfoNoKvfHqtR08dfbfA/pnSC9f1cFnz/QSYgCo1IX1zxmTCWeDWJsE4oRBSFp0JTVtKdfimfP/5uFj/h1QBw8f28Wd+/7LJWv/yskLf0vHrzEALoLFdqqhLeMGKTsuXR6a+AeBJIJIhJc6njqRDKrGH58Lj57xJ20mn6uS8t6OjShpmpwSM0QcjghPBRGPoqAOJ4GfP2nQpr/HjEkq9PZtl7/c5iEJ6Yhg4hmrtPnypV4zViBHVuhT4TICgZiYQJOgLdFkqgUjVjxgbAC6/4p54twOFMmJpJ1FCuQrzVK7jTFgAAQHDJafY6JZRmXqBasA/Pldg0s2+YnuPz0ewcgod/sBSe/TKWkstOWY5PHD+33cfcyv/PhRA4cfiQC5TikOgJJOZ8DfPzT442tT15+BNpPNXmO326bgoGcmZ7xpPIE41VeBZA6kDRp2Zly0zk+cMM8PnDjPL5wwoMOm+579Jv6ac1b7ng8e7wRg8tlr7H7P+NTHDsTaKsWcJubSoS/LA4eXCpFUB1SjQh3tq/HlCzEXbfgznz7fDcC4U0Qstt0oBOKWachKeFc0xWQhIggRjipeajhq+AE5qSGhwqu3dtJm5mWqKAEI+WWoSi7ZEZBhicNphJNheSpD/xs9ak1qLJc2at6X9oKWstGQmIVaEmZYfBRL2B9jQDHSCZ9aB7LGEs1YiJQmojYzUGmy5DZ1Ft3cyvT9x3qsFHMci5IGy3vBKgePTc8/OrIQAYw+oWOyOaKhxGvz48f9vHhdF1ADxLqCJh2LskNvCAIY86wzOmV89XoPl2z5K82+CI8HhDw7Uc6al5jvuv8MFBFi5d/fYr5/r4+37uvinQe7Ia7iqIB4G1SVFBGFPUAQPKfN/xcxTYKqpZ15lZiaFAHqeCJEKgjOjOf0AlVU0pkgNnwAaIRDSzYh2AovDhkJv+Q4qCrHj9v3kyITZ5agjaYEVcpKNr0vsNBn7zn0RzluvP4LVdnFbmi6dar+jy2ZoGjJdk7Od76vchTwdVEvUCQhzDtT6rnSJvdlJdaj3Q/S8Zt3lUVVuUDhZwXKZwRKI1HQ5H5S5Ly44RbtC+6P/wBtq7jMeLq/+gAAAABJRU5ErkJggg==")
        }
        .cm-completionIcon.cm-completionIcon-bootstrap {
            width: 0.95em !important;
            color: transparent !important;
        }
        .cm-completionIcon.cm-completionIcon-bootstrap:after,
        .cm-completionIcon.cm-completionIcon-bootstrap::after {
            content: " " !important;
            display: inline-block !important;
            width: 0.95em !important;
            height: 0.95em !important;
            vertical-align: middle !important;
            background-size: contain !important;
            background-repeat: no-repeat !important;
            background-position: center !important;
            background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAES0lEQVR42p2XA5AESwyGv3TP4tm2bdu2bdu2bdu2bdu2zfPtTucddi81Nap6X9V/N84mlXTSAnDW+DqJaDgRZEVgAqCigKIomNrnmn0PO897t6HKb0HlYVdtHAr8IudOrBOEhr4KTE2LMuMU3S+4hybOv5RmY0E5Z/z4MlXZHsj0gJTnZcYBOy98N8AlTlXWIoViR6aAptT+m/y5FMgQ1bXl7PFCACQv9KFlAMXOMyMlJI8FyiOnUdJ4krafQQfU9lQ1M/SItM4EcC2BquQZB5AIIxG+ljkCMXt+XGe0CYQ8ev5Wun4PfPpkg+cv6uXvbwQRD3gAFCELBaLirA+E0MRXKGSUsWVAnvGn9yywZY279uvgzZsaOATBQ0HSOiWfoNoKvfHqtR08dfbfA/pnSC9f1cFnz/QSYgCo1IX1zxmTCWeDWJsE4oRBSFp0JTVtKdfimfP/5uFj/h1QBw8f28Wd+/7LJWv/yskLf0vHrzEALoLFdqqhLeMGKTsuXR6a+AeBJIJIhJc6njqRDKrGH58Lj57xJ20mn6uS8t6OjShpmpwSM0QcjghPBRGPoqAOJ4GfP2nQpr/HjEkq9PZtl7/c5iEJ6Yhg4hmrtPnypV4zViBHVuhT4TICgZiYQJOgLdFkqgUjVjxgbAC6/4p54twOFMmJpJ1FCuQrzVK7jTFgAAQHDJafY6JZRmXqBasA/Pldg0s2+YnuPz0ewcgod/sBSe/TKWkstOWY5PHD+33cfcyv/PhRA4cfiQC5TikOgJJOZ8DfPzT442tT15+BNpPNXmO326bgoGcmZ7xpPIE41VeBZA6kDRp2Zly0zk+cMM8PnDjPL5wwoMOm+579Jv6ac1b7ng8e7wRg8tlr7H7P+NTHDsTaKsWcJubSoS/LA4eXCpFUB1SjQh3tq/HlCzEXbfgznz7fDcC4U0Qstt0oBOKWachKeFc0xWQhIggRjipeajhq+AE5qSGhwqu3dtJm5mWqKAEI+WWoSi7ZEZBhicNphJNheSpD/xs9ak1qLJc2at6X9oKWstGQmIVaEmZYfBRL2B9jQDHSCZ9aB7LGEs1YiJQmojYzUGmy5DZ1Ft3cyvT9x3qsFHMci5IGy3vBKgePTc8/OrIQAYw+oWOyOaKhxGvz48f9vHhdF1ADxLqCJh2LskNvCAIY86wzOmV89XoPl2z5K82+CI8HhDw7Uc6al5jvuv8MFBFi5d/fYr5/r4+37uvinQe7Ia7iqIB4G1SVFBGFPUAQPKfN/xcxTYKqpZ15lZiaFAHqeCJEKgjOjOf0AlVU0pkgNnwAaIRDSzYh2AovDhkJv+Q4qCrHj9v3kyITZ5agjaYEVcpKNr0vsNBn7zn0RzluvP4LVdnFbmi6dar+jy2ZoGjJdk7Od76vchTwdVEvUCQhzDtT6rnSJvdlJdaj3Q/S8Zt3lUVVuUDhZwXKZwRKI1HQ5H5S5Ly44RbtC+6P/wBtq7jMeLq/+gAAAABJRU5ErkJggg==") !important;
        }
        `;
        this.injectAutocompleteStyles(autocompleteCss);
        // Check if Bootstrap classes are already in cache file
        const storedBootstrapClasses = await cacheFile.readFile('utf8');
        if (storedBootstrapClasses) {
            // If classes are already stored, parse them from the cache
            this.initializeAutocompletion(JSON.parse(storedBootstrapClasses));
        } else {
            // If not, download the Bootstrap CSS file, extract classes, and store them in cache
            const classes = await this.fetchBootstrapClasses();
            // Store classes in cache
            await cacheFile.writeFile(JSON.stringify(classes))
            // Initialize autocompletion with the extracted classes
            this.initializeAutocompletion(classes);
        }
        this.$cacheFile = cacheFile;
    }
    
    private async clearCache() {
        await this.$cacheFile.writeFile("");
    }

    public get settingsObj() {
        return {
            list: [
                {
                    key: "bootstrapUrl",
                    text: "Cdn of Bootstrap Css file",
                    value: this.settings.bootstrapUrl,
                    prompt: "Cdn of Bootstrap Css file",
                    promptType: "text",
                    info: `Cdn of main bootstrap css file to fetch Autocompletion`,
                },
                {
                    key: "clearCache",
                    text: "Clear Cache",
                    info: "Remove downloaded bootstrap completion data"
                },
            ],
            cb: (key: string, value: string) => {
                if(this.settings[key] === "clearCache"){
                    this.clearCache()
                } else {
                    this.settings[key] = value;
                    appSettings.update();
                }
            },
        }
    }

    private get settings() {
        return appSettings.value[plugin.id];
    }

    async destroy() {
        this.initializeAutocompletion([]);
        this.removeCodeMirrorLifecycleListeners();
    }
}

if (window.acode) {
    const acodePlugin = new BootstrapIntelliSense();
    acode.setPluginInit(plugin.id, async (baseUrl: string, $page: WCPage, { cacheFileUrl, cacheFile }: any) => {
        if (!baseUrl.endsWith('/')) {
            baseUrl += '/';
        }
        acodePlugin.baseUrl = baseUrl;
        await acodePlugin.init($page, cacheFile, cacheFileUrl);
    }, acodePlugin.settingsObj);
    acode.setPluginUnmount(plugin.id, () => {
        acodePlugin.destroy();
    });
}
