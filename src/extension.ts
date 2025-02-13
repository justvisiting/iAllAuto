// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';

interface GitRepositoryConfig {
    baseFolders?: string[];
    ignoredFolders?: string[];
    maxDepth?: number;
    scanMode?: 'workspace' | 'custom' | 'both';
}

async function findGitRepositories(): Promise<string[]> {
    const config = vscode.workspace.getConfiguration('iallauto.git');
    const settings: GitRepositoryConfig = {
        baseFolders: config.get('baseFolders'),
        ignoredFolders: config.get('ignoredFolders', ['node_modules', 'out', 'typings', 'test']),
        maxDepth: config.get('maxDepth', 2),
        scanMode: config.get('scanMode', 'workspace')
    };

    const repositories: Set<string> = new Set();
    const pathsToScan: Set<string> = new Set();

    // 1. Get all open text document paths
    const openDocs = vscode.workspace.textDocuments
        .filter(doc => doc.uri.scheme === 'file' && !doc.isUntitled)
        .map(doc => path.dirname(doc.uri.fsPath))
        .filter(isValidPath);

    // Add all unique parent directories of open files (up to 3 levels up)
    for (const docPath of openDocs) {
        let currentPath = docPath;
        for (let i = 0; i < 3; i++) {
            if (isValidPath(currentPath)) {
                pathsToScan.add(currentPath);
            }
            const parentPath = path.dirname(currentPath);
            if (parentPath === currentPath) break;
            currentPath = parentPath;
        }
    }

    // 2. Add workspace folders if enabled
    if (settings.scanMode !== 'custom') {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            workspaceFolders
                .map(folder => folder.uri.fsPath)
                .filter(isValidPath)
                .forEach(path => pathsToScan.add(path));
        }
    }

    // 3. Add custom base folders if configured
    if (settings.scanMode !== 'workspace' && settings.baseFolders && settings.baseFolders.length > 0) {
        settings.baseFolders
            .map(expandPath)
            .filter(isValidPath)
            .forEach(path => pathsToScan.add(path));
    }

    // Log scanning paths for debugging
    console.log('Paths to scan:', Array.from(pathsToScan));

    // If no valid paths found, show configuration message
    if (pathsToScan.size === 0) {
        vscode.window.showWarningMessage(
            'No valid workspace or repository paths found. Would you like to configure repository paths?',
            'Configure Now'
        ).then(selection => {
            if (selection === 'Configure Now') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'iallauto.git.baseFolders');
            }
        });
        return [];
    }

    // Scan all valid paths for repositories
    for (const dirPath of pathsToScan) {
        try {
            // Quick check if this path itself is a git repo
            const git = simpleGit(dirPath);
            const isRepo = await git.checkIsRepo();
            if (isRepo) {
                repositories.add(dirPath);
                continue; // No need to scan subdirectories if this is already a repo
            }

            // If not a repo, scan subdirectories
            await scanDirectory(dirPath, 0, settings, repositories);
        } catch (error) {
            console.error(`Error scanning directory ${dirPath}:`, error);
        }
    }

    // Sort repositories by path length (shorter paths first)
    return Array.from(repositories).sort((a, b) => a.length - b.length);
}

function isValidPath(p: string): boolean {
    // Don't allow root directory or very short paths
    if (p === '/' || p === '\\' || p.length < 3) {
        return false;
    }

    try {
        // Check if path exists and is a directory
        return require('fs').statSync(p).isDirectory();
    } catch (error) {
        return false;
    }
}

function expandPath(p: string): string {
    // Handle environment variables
    const expanded = p.replace(/\$([A-Za-z0-9_]+)/g, (_, name) => process.env[name] || '');
    
    // Handle home directory shorthand
    if (expanded.startsWith('~/')) {
        return path.join(process.env.HOME || process.env.USERPROFILE || '', expanded.slice(2));
    }

    return expanded;
}

async function scanDirectory(
    directory: string,
    depth: number,
    config: GitRepositoryConfig,
    repositories: Set<string>
): Promise<void> {
    try {
        // Check depth limit
        if (depth > (config.maxDepth || 2)) {
            return;
        }

        // Check if directory should be ignored
        const dirName = path.basename(directory);
        if (config.ignoredFolders?.some(pattern => {
            if (pattern.includes('*')) {
                return new RegExp('^' + pattern.replace(/\*/g, '.*') + '$').test(dirName);
            }
            return pattern === dirName;
        })) {
            return;
        }

        // Check if directory is a git repository
        const git = simpleGit(directory);
        const isRepo = await git.checkIsRepo();
        if (isRepo) {
            repositories.add(directory);
            // Don't scan deeper if we found a repository
            return;
        }

        // Scan subdirectories
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(directory));
        for (const [name, type] of entries) {
            if (type === vscode.FileType.Directory) {
                await scanDirectory(path.join(directory, name), depth + 1, config, repositories);
            }
        }
    } catch (error) {
        console.error(`Error scanning directory ${directory}:`, error);
    }
}

class CommitViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _git?: SimpleGit;
    private _isGitRepo: boolean = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _workspaceRoot: string
    ) {
        this.initGit();
    }

    private async initGit() {
        try {
            if (!this._workspaceRoot) {
                console.log('No workspace root available');
                return;
            }

            // Initialize simple-git
            this._git = simpleGit(this._workspaceRoot);
            
            // Check if it's a git repository
            const isRepo = await this._git.checkIsRepo();
            if (!isRepo) {
                console.log('Not a git repository:', this._workspaceRoot);
                this._isGitRepo = false;
                if (this._view) {
                    this._view.webview.html = this._getNotGitRepoHtml();
                }
                return;
            }

            this._isGitRepo = true;
            console.log('Git repository initialized at:', this._workspaceRoot);
            
            // Initial refresh if view exists
            if (this._view) {
                this.refreshChanges();
            }
        } catch (error) {
            console.error('Failed to initialize git:', error);
            this._isGitRepo = false;
            if (this._view) {
                this._view.webview.html = this._getNotGitRepoHtml();
            }
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        if (!this._isGitRepo) {
            webviewView.webview.html = this._getNotGitRepoHtml();
            return;
        }

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (!this._git || !this._isGitRepo) {
                vscode.window.showErrorMessage('Not a git repository');
                return;
            }

            switch (data.type) {
                case 'commit':
                    try {
                        await this._git.add('./*');
                        await this._git.commit(data.message);
                        vscode.window.showInformationMessage('Changes committed successfully!');
                        this.refreshChanges();
                    } catch (error) {
                        vscode.window.showErrorMessage('Failed to commit changes: ' + error);
                    }
                    break;
                case 'refresh':
                    this.refreshChanges();
                    break;
                case 'init':
                    try {
                        await this._git.init();
                        this._isGitRepo = true;
                        vscode.window.showInformationMessage('Git repository initialized successfully!');
                        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
                        this.refreshChanges();
                    } catch (error) {
                        vscode.window.showErrorMessage('Failed to initialize git repository: ' + error);
                    }
                    break;
            }
        });

        // Initial refresh
        this.refreshChanges();
    }

    private async refreshChanges() {
        if (!this._view || !this._git || !this._isGitRepo) {
            return;
        }

        try {
            const status = await this._git.status();
            const changes = {
                staged: status.staged,
                modified: status.modified,
                untracked: status.not_added
            };

            this._view.webview.postMessage({
                type: 'refresh',
                changes: changes
            });
        } catch (error) {
            console.error('Failed to get git status:', error);
            vscode.window.showErrorMessage('Failed to get git status: ' + error);
        }
    }

    private _getNotGitRepoHtml() {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Not a Git Repository</title>
                <style>
                    body {
                        padding: 10px;
                        color: var(--vscode-foreground);
                        font-family: var(--vscode-font-family);
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        text-align: center;
                    }
                    button {
                        margin-top: 10px;
                        padding: 8px 16px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <h3>Not a Git Repository</h3>
                <p>This folder is not a git repository.</p>
                <button onclick="initRepo()">Initialize Git Repository</button>
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    function initRepo() {
                        vscode.postMessage({ type: 'init' });
                    }
                </script>
            </body>
            </html>
        `;
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Commit Changes</title>
                <style>
                    body {
                        padding: 10px;
                        color: var(--vscode-foreground);
                        font-family: var(--vscode-font-family);
                    }
                    .container {
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                    }
                    .files-section {
                        flex: 1;
                        margin-bottom: 10px;
                        border: 1px solid var(--vscode-panel-border);
                        overflow-y: auto;
                    }
                    .file-list {
                        list-style: none;
                        padding: 0;
                        margin: 0;
                    }
                    .file-item {
                        padding: 4px 8px;
                        display: flex;
                        align-items: center;
                    }
                    .file-item:hover {
                        background-color: var(--vscode-list-hoverBackground);
                    }
                    .commit-section {
                        margin-top: 10px;
                    }
                    textarea {
                        width: 100%;
                        min-height: 100px;
                        margin-bottom: 10px;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        padding: 5px;
                    }
                    button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 8px 12px;
                        cursor: pointer;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    .section-title {
                        padding: 5px;
                        background-color: var(--vscode-sideBarSectionHeader-background);
                        font-weight: bold;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="files-section">
                        <div class="section-title">Changed Files</div>
                        <div id="fileList"></div>
                    </div>
                    <div class="commit-section">
                        <textarea id="commitMessage" placeholder="Commit message"></textarea>
                        <button id="commitButton">Commit</button>
                        <button id="refreshButton">Refresh</button>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    document.getElementById('commitButton').addEventListener('click', () => {
                        const message = document.getElementById('commitMessage').value;
                        if (message) {
                            vscode.postMessage({
                                type: 'commit',
                                message: message
                            });
                        }
                    });

                    document.getElementById('refreshButton').addEventListener('click', () => {
                        vscode.postMessage({ type: 'refresh' });
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'refresh':
                                updateFileList(message.changes);
                                break;
                        }
                    });

                    function updateFileList(changes) {
                        const fileList = document.getElementById('fileList');
                        fileList.innerHTML = '';

                        const list = document.createElement('ul');
                        list.className = 'file-list';

                        // Add staged files
                        changes.staged.forEach(file => {
                            addFileItem(list, file, 'Staged');
                        });

                        // Add modified files
                        changes.modified.forEach(file => {
                            addFileItem(list, file, 'Modified');
                        });

                        // Add untracked files
                        changes.untracked.forEach(file => {
                            addFileItem(list, file, 'Untracked');
                        });

                        fileList.appendChild(list);
                    }

                    function addFileItem(list, file, status) {
                        const item = document.createElement('li');
                        item.className = 'file-item';
                        item.innerHTML = \`
                            <input type="checkbox" checked />
                            <span style="margin-left: 5px;">\${file} (\${status})</span>
                        \`;
                        list.appendChild(item);
                    }
                </script>
            </body>
            </html>
        `;
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Activating iAllAuto extension...');

    // Register commands first
    const showCommitViewCommand = vscode.commands.registerCommand('iallauto.showCommitView', () => {
        vscode.commands.executeCommand('workbench.view.scm');
    });

    const refreshReposCommand = vscode.commands.registerCommand('iallauto.refreshRepositories', async () => {
        try {
            const repos = await findGitRepositories();
            if (repos.length > 0) {
                vscode.window.showInformationMessage(
                    `Found ${repos.length} Git ${repos.length === 1 ? 'repository' : 'repositories'}`
                );
            }
            return repos;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error refreshing repositories:', error);
            vscode.window.showErrorMessage('Failed to refresh repositories: ' + errorMessage);
            return [];
        }
    });

    // Add commands to subscriptions immediately
    context.subscriptions.push(showCommitViewCommand, refreshReposCommand);

    // Initialize repositories and provider
    findGitRepositories().then(repositories => {
        console.log('=== Git Repositories ===');
        console.log(JSON.stringify(repositories, null, 2));
        console.log('=======================');

        if (repositories.length === 0) {
            vscode.window.showWarningMessage(
                'No Git repositories found. Please open a workspace or configure base folders in settings.',
                'Configure Settings'
            ).then(selection => {
                if (selection === 'Configure Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'iallauto.git');
                }
            });
            return;
        }

        // Use the first repository as the working directory
        const workspaceRoot = repositories[0];
        console.log('Selected repository:', workspaceRoot);

        try {
            const provider = new CommitViewProvider(context.extensionUri, workspaceRoot);
            const providerRegistration = vscode.window.registerWebviewViewProvider('iallAutoCommitView', provider);
            context.subscriptions.push(providerRegistration);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error creating commit view provider:', error);
            vscode.window.showErrorMessage('Failed to initialize commit view: ' + errorMessage);
        }
    }).catch(error => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error during activation:', error);
        vscode.window.showErrorMessage('Failed to initialize extension: ' + errorMessage);
    });
}

export function deactivate() {}
