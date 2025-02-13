// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { simpleGit, SimpleGit } from 'simple-git';

interface GitRepositoryConfig {
    baseFolders?: string[];
    ignoredFolders?: string[];
    maxDepth?: number;
    scanMode?: 'workspace' | 'custom' | 'both';
}

async function scanForGitRepos(directory: string, maxDepth: number = 3): Promise<string[]> {
    const repositories: Set<string> = new Set();
    
    async function scan(dir: string, depth: number) {
        if (depth > maxDepth) return;
        
        try {
            // Check if current directory is a git repo
            const git = simpleGit(dir);
            const isRepo = await git.checkIsRepo();
            if (isRepo) {
                repositories.add(dir);
                return; // Don't scan subdirectories of a git repo
            }

            // Read directory contents
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
            
            // Scan subdirectories
            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory && name !== 'node_modules' && name !== '.git') {
                    await scan(path.join(dir, name), depth + 1);
                }
            }
        } catch (error) {
            console.log(`Error scanning directory ${dir}:`, error);
        }
    }

    await scan(directory, 0);
    return Array.from(repositories);
}

export async function findGitRepositories(): Promise<string[]> {
    const repositories: Set<string> = new Set();

    // Get workspace folders
    if (vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
            const repos = await scanForGitRepos(folder.uri.fsPath);
            repos.forEach(repo => repositories.add(repo));
        }
    }

    return Array.from(repositories);
}

interface GitFileStatus {
    path: string;
    repoPath: string;
    isVersioned: boolean;
}

interface GitStatus {
    repositories: {
        [repoPath: string]: {
            versioned: string[];
            unversioned: string[];
        }
    };
}

class CommitViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _gitRepos: Map<string, SimpleGit> = new Map();
    private _extensionPath: string;
    private _repositories: string[];
    private _isTreeView: boolean = true;
    private static _currentProvider: CommitViewProvider | undefined;

    constructor(
        extensionPath: string,
        private readonly _extensionUri: vscode.Uri,
        repositories: string[]
    ) {
        this._extensionPath = extensionPath;
        this._repositories = repositories;
        // Initialize git for each repository
        for (const repoPath of repositories) {
            this._gitRepos.set(repoPath, simpleGit(repoPath));
        }
        CommitViewProvider._currentProvider = this;
    }

    public static get current(): CommitViewProvider | undefined {
        return CommitViewProvider._currentProvider;
    }

    public refresh() {
        this._updateChanges();
    }

    public updateRepositories(repositories: string[]) {
        this._repositories = repositories;
        this._gitRepos.clear();
        for (const repoPath of repositories) {
            this._gitRepos.set(repoPath, simpleGit(repoPath));
        }
        this._updateChanges();
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        console.log('Resolving webview view...');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = await this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            console.log('Received message from webview:', data);
            switch (data.type) {
                case 'refresh':
                    await this._updateChanges();
                    break;
                case 'commit':
                    await this._commitChanges(data.message, data.files);
                    break;
            }
        });

        // Initial update
        console.log('Performing initial update...');
        await this._updateChanges();
    }

    public toggleViewMode() {
        this._isTreeView = !this._isTreeView;
        if (this._view) {
            this._view.webview.postMessage({ 
                type: 'toggleViewMode',
                isTreeView: this._isTreeView
            });
        }
    }

    private async _updateChanges() {
        if (!this._view) {
            console.log('View not initialized yet');
            return;
        }

        try {
            console.log('Updating changes...');
            const status = await this._getGitStatus();
            console.log('Got git status:', status);

            this._view.webview.postMessage({
                type: 'updateChanges',
                status
            });
            console.log('Posted updateChanges message to webview');
        } catch (error) {
            console.error('Failed to update changes:', error);
            vscode.window.showErrorMessage('Failed to update changes: ' + (error instanceof Error ? error.message : String(error)));
        }
    }

    private async _getGitStatus(): Promise<GitStatus> {
        const repositories: GitStatus['repositories'] = {};

        // Get status for each repository
        for (const [repoPath, git] of this._gitRepos.entries()) {
            try {
                console.log(`Getting status for repo: ${repoPath}`);
                const status = await git.status();
                console.log(`Raw status for ${repoPath}:`, status);
                
                // All versioned files with changes
                const versioned = [
                    ...status.staged,
                    ...status.created,
                    ...status.modified,
                    ...status.renamed.map(f => f.to),
                    ...status.deleted
                ];

                // Files not tracked by git
                const unversioned = [...status.not_added];

                repositories[repoPath] = {
                    versioned: [...new Set(versioned)], // Remove duplicates
                    unversioned
                };
                
                console.log(`Processed status for ${repoPath}:`, repositories[repoPath]);
            } catch (error) {
                console.error(`Error getting status for repo ${repoPath}:`, error);
                repositories[repoPath] = { versioned: [], unversioned: [] };
            }
        }

        console.log('Final git status:', { repositories });
        return { repositories };
    }

    private async _commitChanges(message: string, files: Array<{ path: string, repo: string }>) {
        // Group files by repository
        const filesByRepo = new Map<string, string[]>();
        for (const file of files) {
            const repoFiles = filesByRepo.get(file.repo) || [];
            repoFiles.push(file.path);
            filesByRepo.set(file.repo, repoFiles);
        }

        // Commit in each repository
        const results: Array<{ repo: string, success: boolean, error?: string }> = [];
        
        for (const [repoPath, filesToCommit] of filesByRepo.entries()) {
            const git = this._gitRepos.get(repoPath);
            if (!git) continue;

            try {
                // Stage selected files
                await git.add(filesToCommit);
                // Commit changes
                await git.commit(message);
                results.push({ repo: repoPath, success: true });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                results.push({ repo: repoPath, success: false, error: errorMessage });
            }
        }

        // Show results
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        if (successful > 0) {
            vscode.window.showInformationMessage(
                `Changes committed successfully in ${successful} ${successful === 1 ? 'repository' : 'repositories'}`
            );
        }

        if (failed > 0) {
            const errors = results
                .filter(r => !r.success)
                .map(r => `${path.basename(r.repo)}: ${r.error}`)
                .join('\n');
            vscode.window.showErrorMessage(`Failed to commit in ${failed} ${failed === 1 ? 'repository' : 'repositories'}:\n${errors}`);
        }

        // Refresh the view
        await this._updateChanges();
    }

    private async _getHtmlForWebview(webview: vscode.Webview) {
        const htmlPath = path.join(this._extensionPath, 'src', 'webview', 'commit-view.html');
        const cssPath = path.join(this._extensionPath, 'src', 'webview', 'styles.css');
        const jsPath = path.join(this._extensionPath, 'src', 'webview', 'script.js');

        let html = await fs.promises.readFile(htmlPath, 'utf8');
        const css = await fs.promises.readFile(cssPath, 'utf8');
        const js = await fs.promises.readFile(jsPath, 'utf8');

        // Replace placeholders with actual content
        html = html.replace('/* Content will be replaced with styles.css */', css);
        html = html.replace('/* Content will be replaced with script.js */', js);

        return html;
    }

    public show() {
        vscode.commands.executeCommand('vscode.openView', 'iallAutoCommitView', vscode.ViewColumn.One);
    }
}

export function activate(context: vscode.ExtensionContext) {
    try {
        // Initialize repositories and provider
        findGitRepositories().then(repositories => {
            console.log('Found repositories:', repositories);
            
            const provider = new CommitViewProvider(
                context.extensionPath,
                context.extensionUri,
                repositories
            );

            const view = vscode.window.registerWebviewViewProvider(
                'iallAutoCommitView',
                provider
            );

            // Register commands
            const showCommitViewCommand = vscode.commands.registerCommand(
                'iallauto.showCommitView',
                () => {
                    provider.show();
                }
            );

            const refreshCommand = vscode.commands.registerCommand(
                'iallAutoCommit.refresh',
                () => {
                    provider.refresh();
                }
            );

            const toggleViewCommand = vscode.commands.registerCommand(
                'iallAutoCommit.toggleViewMode',
                () => {
                    console.log('Toggle view command triggered');
                    provider.toggleViewMode();
                }
            );

            context.subscriptions.push(
                view,
                showCommitViewCommand,
                refreshCommand,
                toggleViewCommand
            );
        }).catch(error => {
            console.error('Error finding repositories:', error);
            vscode.window.showErrorMessage('Error finding repositories: ' + error);
        });

    } catch (error) {
        console.error('Error activating extension:', error);
        vscode.window.showErrorMessage('Error activating extension: ' + error);
    }
}

export function deactivate() {}
