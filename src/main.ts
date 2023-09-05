import plugin from '../plugin.json';

const appSettings = acode.require("settings");
const bootstrapCssFileUrl: string = "https://cdn.jsdelivr.net/npm/bootstrap@latest/dist/css/bootstrap.css";

class BootstrapIntelliSense {
    public baseUrl: string | undefined;
    
    private $cacheFile!: any;
    
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
            const response = await fetch(bootstrapCssFileUrl);
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


    private initializeAutocompletion(classes: Array<string>) {
        let staticWordCompleter = {
            getCompletions: (editor: AceAjax.Editor, session: any, pos: AceAjax.Position, prefix: string, callback: (err: any, results: AceAjax.Completion[]) => void) => {
                if (session.getMode().$id === 'ace/mode/html' || session.getMode().$id === 'ace/mode/jsx') {
                    let line = session.getLine(pos.row).substr(0, pos.column);
                    // Check if the cursor is inside a class attribute
                    if (line.includes('class="') || line.includes('className="')) {
                        // Extract Bootstrap classes and provide autocompletion
                        callback(null, classes.map(function (word: string) {
                            return {
                                caption: word,
                                value: word,
                                meta: "bootstrap"
                            };
                        }));
                        return;
                    } else {
                        callback(null, []);
                    }
                }
                // If not in a valid context, provide an empty autocompletion list
                callback(null, []);
            }
        };
        editorManager.editor.completers.unshift(staticWordCompleter);
    }

    async init($page: WCPage, cacheFile: any, cacheFileUrl: string): Promise<void> {
        const styling = document.createElement("style");
        styling.innerHTML = `
        .ace_autocomplete .ace_completion-icon.ace_bootstrap {
            background-size: contain;
            background-repeat: no-repeat;
            height: 1em;
            width: 1em;
            background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAES0lEQVR42p2XA5AESwyGv3TP4tm2bdu2bdu2bdu2bdu2zfPtTucddi81Nap6X9V/N84mlXTSAnDW+DqJaDgRZEVgAqCigKIomNrnmn0PO897t6HKb0HlYVdtHAr8IudOrBOEhr4KTE2LMuMU3S+4hybOv5RmY0E5Z/z4MlXZHsj0gJTnZcYBOy98N8AlTlXWIoViR6aAptT+m/y5FMgQ1bXl7PFCACQv9KFlAMXOMyMlJI8FyiOnUdJ4krafQQfU9lQ1M/SItM4EcC2BquQZB5AIIxG+ljkCMXt+XGe0CYQ8ev5Wun4PfPpkg+cv6uXvbwQRD3gAFCELBaLirA+E0MRXKGSUsWVAnvGn9yywZY279uvgzZsaOATBQ0HSOiWfoNoKvfHqtR08dfbfA/pnSC9f1cFnz/QSYgCo1IX1zxmTCWeDWJsE4oRBSFp0JTVtKdfimfP/5uFj/h1QBw8f28Wd+/7LJWv/yskLf0vHrzEALoLFdqqhLeMGKTsuXR6a+AeBJIJIhJc6njqRDKrGH58Lj57xJ20mn6uS8t6OjShpmpwSM0QcjghPBRGPoqAOJ4GfP2nQpr/HjEkq9PZtl7/c5iEJ6Yhg4hmrtPnypV4zViBHVuhT4TICgZiYQJOgLdFkqgUjVjxgbAC6/4p54twOFMmJpJ1FCuQrzVK7jTFgAAQHDJafY6JZRmXqBasA/Pldg0s2+YnuPz0ewcgod/sBSe/TKWkstOWY5PHD+33cfcyv/PhRA4cfiQC5TikOgJJOZ8DfPzT442tT15+BNpPNXmO326bgoGcmZ7xpPIE41VeBZA6kDRp2Zly0zk+cMM8PnDjPL5wwoMOm+579Jv6ac1b7ng8e7wRg8tlr7H7P+NTHDsTaKsWcJubSoS/LA4eXCpFUB1SjQh3tq/HlCzEXbfgznz7fDcC4U0Qstt0oBOKWachKeFc0xWQhIggRjipeajhq+AE5qSGhwqu3dtJm5mWqKAEI+WWoSi7ZEZBhicNphJNheSpD/xs9ak1qLJc2at6X9oKWstGQmIVaEmZYfBRL2B9jQDHSCZ9aB7LGEs1YiJQmojYzUGmy5DZ1Ft3cyvT9x3qsFHMci5IGy3vBKgePTc8/OrIQAYw+oWOyOaKhxGvz48f9vHhdF1ADxLqCJh2LskNvCAIY86wzOmV89XoPl2z5K82+CI8HhDw7Uc6al5jvuv8MFBFi5d/fYr5/r4+37uvinQe7Ia7iqIB4G1SVFBGFPUAQPKfN/xcxTYKqpZ15lZiaFAHqeCJEKgjOjOf0AlVU0pkgNnwAaIRDSzYh2AovDhkJv+Q4qCrHj9v3kyITZ5agjaYEVcpKNr0vsNBn7zn0RzluvP4LVdnFbmi6dar+jy2ZoGjJdk7Od76vchTwdVEvUCQhzDtT6rnSJvdlJdaj3Q/S8Zt3lUVVuUDhZwXKZwRKI1HQ5H5S5Ly44RbtC+6P/wBtq7jMeLq/+gAAAABJRU5ErkJggg==")
        }
        `;
        document.head.append(styling);
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
