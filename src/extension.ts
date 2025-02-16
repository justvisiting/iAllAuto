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
    private _selectedRepos: Set<string> = new Set();
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

    public getRepositories(): string[] {
        return this._repositories;
    }

    public getSelectedRepos(): Set<string> {
        return this._selectedRepos;
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

    public updateSelectedRepos(repos: string[]) {
        this._selectedRepos = new Set(repos);
        this._updateChanges();
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        console.log('Resolving webview view...');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            enableCommandUris: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.joinPath(this._extensionUri, 'out'),
                vscode.Uri.joinPath(this._extensionUri, 'src')
            ]
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
                case 'push':
                    await this._pushChanges();
                    break;
                case 'openFile':
                    try {
                        const uri = vscode.Uri.file(data.file);
                        const doc = await vscode.workspace.openTextDocument(uri);
                        await vscode.window.showTextDocument(doc);
                        
                        // Send success response
                        webviewView.webview.postMessage({
                            type: 'fileOpened',
                            file: data.file,
                            success: true
                        });
                    } catch (error: any) {
                        console.error('Error opening file:', error);
                        // Send error response
                        webviewView.webview.postMessage({
                            type: 'fileError',
                            file: data.file,
                            success: false,
                            error: error?.message || 'Unknown error'
                        });
                    }
                    break;
                case 'openDiff':
                    try {
                        const uri = vscode.Uri.file(data.file);
                        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
                        const git = gitExtension.getAPI(1);

                        if (git) {
                            // Get the repository for this file
                            const repository = git.repositories.find((repo: any) => 
                                data.file.startsWith(repo.rootUri.fsPath)
                            );

                            if (repository) {
                                // Use Git API to create URI
                                const headUri = git.toGitUri(uri, 'HEAD');
                                
                                // Open diff between working tree and HEAD
                                await vscode.commands.executeCommand('vscode.diff',
                                    
                                    headUri,    // HEAD version from Git
                                    uri,        // current working tree version
                                    `${data.file} (Working Tree ↔ HEAD)`, // title
                                    { preserveFocus: true }  // Keep focus in webview
                                );
                                
                                // Send success response
                                webviewView.webview.postMessage({
                                    type: 'diffOpened',
                                    file: data.file,
                                    success: true
                                });
                            } else {
                                throw new Error('No Git repository found for this file');
                            }
                        } else {
                            throw new Error('Git extension not available');
                        }
                    } catch (error: any) {
                        console.error('Error opening diff:', error);
                        // Send error response
                        webviewView.webview.postMessage({
                            type: 'diffError',
                            file: data.file,
                            success: false,
                            error: error?.message || 'Unknown error'
                        });
                    }
                    break;
            }
        });

        // Initial update
        console.log('Performing initial update...', webviewView.webview.html);
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
        const status: GitStatus = {
            repositories: {}
        };

        const reposToProcess = this._selectedRepos.size > 0 
            ? Array.from(this._selectedRepos)
            : this._repositories;

        for (const repoPath of reposToProcess) {
            try {
                console.log(`Getting status for repo: ${repoPath}`);
                const git = this._gitRepos.get(repoPath);
                if (!git) {
                    console.error(`No git instance found for repo ${repoPath}`);
                    continue;
                }

                const statusResult = await git.status();
                console.log(`Raw status for ${repoPath}:`, statusResult);
                
                // All versioned files with changes
                const versioned = [
                    ...statusResult.staged,
                    ...statusResult.created,
                    ...statusResult.modified,
                    ...statusResult.renamed.map(f => f.to),
                    ...statusResult.deleted
                ];

                // Files not tracked by git
                const unversioned = [...statusResult.not_added];

                status.repositories[repoPath] = {
                    versioned: [...new Set(versioned)], // Remove duplicates
                    unversioned
                };
                
                console.log(`Processed status for ${repoPath}:`, status.repositories[repoPath]);
            } catch (error) {
                console.error(`Error getting status for repo ${repoPath}:`, error);
                status.repositories[repoPath] = { versioned: [], unversioned: [] };
            }
        }

        console.log('Final git status:', status);
        return status;
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

    private async _pushChanges() {
        // Group files by repository
        const results: Array<{ repo: string, success: boolean, error?: string }> = [];
        
        for (const [repoPath, git] of this._gitRepos.entries()) {
            try {
                // Push changes
                await git.push();
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
                `Changes pushed successfully in ${successful} ${successful === 1 ? 'repository' : 'repositories'}`
            );
        }

        if (failed > 0) {
            const errors = results
                .filter(r => !r.success)
                .map(r => `${path.basename(r.repo)}: ${r.error}`)
                .join('\n');
            vscode.window.showErrorMessage(`Failed to push in ${failed} ${failed === 1 ? 'repository' : 'repositories'}:\n${errors}`);
        }

        // Refresh the view
        await this._updateChanges();
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Get paths to resource files
        const scriptPath = vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'script.js');
        const stylesPath = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'styles.css');
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        // And get the resource URIs
        const scriptUri = webview.asWebviewUri(scriptPath);
        const stylesUri = webview.asWebviewUri(stylesPath);

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src ${webview.cspSource} 'unsafe-inline';">
                <link href="${stylesUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet" />
                <title>Git Changes</title>
            </head>
            <body>
                
                <div id="tree-root"></div>
                <div id="commit-section">
                    <textarea id="commit-message" placeholder="Enter commit message"></textarea>
                    <button id="commit-button" disabled>Commit Changes</button>
                </div>
                <div id="status-message"></div>
                
                <script>
                    console.log('Setting up error handlers...');
                    window.onerror = function(msg, url, line, col, error) {
                        console.error('Global error:', { message: msg, url, line, col, error });
                        const statusDiv = document.getElementById('status-message');
                        if (statusDiv) {
                            statusDiv.textContent = 'Error: ' + msg;
                            statusDiv.style.color = 'red';
                        }
                        return false;
                    };
                </script>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    public show() {
        vscode.commands.executeCommand('workbench.view.scm');
        vscode.commands.executeCommand('workbench.view.extension.iallAutoCommitView');
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

            const selectReposCommand = vscode.commands.registerCommand(
                'iallAutoCommit.selectRepositories',
                async () => {
                    const repos = provider.getRepositories();
                    const items = repos.map(repo => ({
                        label: path.basename(repo),
                        description: repo,
                        picked: provider.getSelectedRepos().has(repo)
                    }));

                    const selected = await vscode.window.showQuickPick(items, {
                        canPickMany: true,
                        title: 'Select Repositories to show',
                        placeHolder: 'Select repositories to show'
                    });

                    if (selected) {
                        const selectedRepos = selected.map(item => item.description);
                        provider.updateSelectedRepos(selectedRepos);
                    }
                }
            );

            context.subscriptions.push(
                view,
                showCommitViewCommand,
                refreshCommand,
                toggleViewCommand,
                selectReposCommand
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
